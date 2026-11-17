import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { ClickEventJobPayload } from '../src/analytics/analytics.constants';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-09');
fs.mkdirSync(evidenceDir, { recursive: true });

const testLogFile = path.join(evidenceDir, 'test-suite.txt');
const summaryLogFile = path.join(evidenceDir, 'integration-tests.txt');
fs.writeFileSync(testLogFile, '', 'utf8');
fs.writeFileSync(summaryLogFile, '', 'utf8');

let passed = 0;
const failures: string[] = [];

function log(msg: string): void {
  console.log(msg);
  fs.appendFileSync(testLogFile, msg + '\n', 'utf8');
  fs.appendFileSync(summaryLogFile, msg + '\n', 'utf8');
}

function assertCheck(condition: boolean, label: string, details?: string): void {
  if (condition) {
    passed++;
    log(`[PASS] ${label}${details ? ` — ${details}` : ''}`);
  } else {
    const failureMsg = `${label}${details ? ` — ${details}` : ''}`;
    failures.push(failureMsg);
    log(`[FAIL] ${failureMsg}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ====================================================================
// SECTION 1: MANDATORY DATABASE & REDIS ISOLATION ENFORCEMENT
// ====================================================================

process.env.NODE_ENV = 'test';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/upsk_sdf_test?schema=public';
const TEST_REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';
const TEST_PORT = 3199;

function sanitizeUrl(rawUrl: string): string {
  return rawUrl.replace(/:([^:@/]+)@/, ':***@');
}

function validateDatabaseIsolation(rawUrl: string): { dbName: string; host: string; port: string; env: string } {
  try {
    const lowerUrl = rawUrl.toLowerCase();
    if (
      lowerUrl.includes('prod') ||
      lowerUrl.includes('production') ||
      lowerUrl.includes('live') ||
      lowerUrl.includes('staging') ||
      lowerUrl.includes('rds.amazonaws.com') ||
      lowerUrl.includes('railway.app')
    ) {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Database URL appears to target production/staging! Refusing execution.`,
      );
    }

    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      throw new Error(`CRITICAL SAFETY VIOLATION: Database protocol "${parsed.protocol}" is not postgresql. Refusing execution.`);
    }
    const dbName = parsed.pathname.replace(/^\//, '');
    const host = parsed.hostname;
    const port = parsed.port || '5432';
    const env = process.env.NODE_ENV || 'development';

    if (dbName !== 'upsk_sdf_test') {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Target database "${dbName}" is not the approved test database "upsk_sdf_test"! Refusing execution.`,
      );
    }
    if (host !== 'localhost' && host !== '127.0.0.1') {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Target host "${host}" is not local. Refusing execution.`,
      );
    }
    if (port !== '5432') {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Target port "${port}" is not expected port 5432. Refusing execution.`,
      );
    }
    if (env !== 'test') {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Execution environment "${env}" is not explicitly "test". Refusing execution.`,
      );
    }
    return { dbName, host, port, env };
  } catch (err: any) {
    throw new Error(`Database URL validation failed: ${err.message}`);
  }
}

function validateRedisIsolation(rawUrl: string): { dbIndex: number; host: string; port: string } {
  try {
    const lowerRedis = rawUrl.toLowerCase();
    if (
      lowerRedis.includes('prod') ||
      lowerRedis.includes('production') ||
      lowerRedis.includes('live') ||
      lowerRedis.includes('upstash') ||
      lowerRedis.includes('redislabs')
    ) {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Redis URL appears to target production! Refusing execution.`,
      );
    }

    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
      throw new Error(`CRITICAL SAFETY VIOLATION: Redis protocol "${parsed.protocol}" is not redis. Refusing execution.`);
    }
    const host = parsed.hostname;
    const port = parsed.port || '6379';
    const dbPath = parsed.pathname.replace(/^\//, '');
    const dbIndex = dbPath === '' ? 0 : parseInt(dbPath, 10);

    if (host !== 'localhost' && host !== '127.0.0.1') {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Target Redis host "${host}" is not local. Refusing execution.`,
      );
    }
    if (port !== '6379') {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Target Redis port "${port}" is not expected port 6379. Refusing execution.`,
      );
    }
    if (dbIndex !== 1) {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Redis DB index "${dbIndex}" is not the approved isolated test DB 1! Refusing execution.`,
      );
    }
    return { dbIndex, host, port };
  } catch (err: any) {
    throw new Error(`Redis URL validation failed: ${err.message}`);
  }
}

async function stopProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.killed) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
      resolve();
    }, 4000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function startApiServer(port: number): Promise<ChildProcess> {
  const apiDir = path.resolve(__dirname, '..');
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const child = spawn(process.execPath, [path.join(apiDir, 'dist/main.js')], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      ANALYTICS_RETENTION_DAYS: '30',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk: Buffer) => stdoutLines.push(chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => stderrLines.push(chunk.toString('utf8')));

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) {
      throw new Error(
        `API process exited early with code ${child.exitCode}:\n${[...stdoutLines, ...stderrLines].join('\n')}`,
      );
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.status === 200) {
        return child;
      }
    } catch {}
    await sleep(250);
  }

  await stopProcess(child);
  throw new Error(`API failed to boot on port ${port} within 15s`);
}

async function login(baseUrl: string, email: string, pass: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass }),
  });
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error(`Failed to login as ${email}: status=${res.status}`);
  }
  return data.access_token;
}

// ====================================================================
// MAIN VERIFICATION SUITE
// ====================================================================

async function run(): Promise<void> {
  log('====================================================================');
  log('Module 09: Integration-Heavy Testing Suite');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('====================================================================\n');

  // Step 1: Pre-flight Safety Validation
  log('--- SECTION 0: Pre-flight Isolation & Safety Verification ---');
  const dbInfo = validateDatabaseIsolation(TEST_DATABASE_URL);
  const redisInfo = validateRedisIsolation(TEST_REDIS_URL);
  log(`[TEST-SETUP] Target Test Database: ${sanitizeUrl(TEST_DATABASE_URL)}`);
  log(`[TEST-SETUP] Target Test Redis: ${sanitizeUrl(TEST_REDIS_URL)}`);
  log(`[TEST-SETUP] Target Test Port: ${TEST_PORT}`);

  assertCheck(
    dbInfo.dbName === 'upsk_sdf_test' &&
      dbInfo.port === '5432' &&
      dbInfo.env === 'test' &&
      (dbInfo.host === 'localhost' || dbInfo.host === '127.0.0.1'),
    'Database safety pre-flight: Target database is explicitly upsk_sdf_test on port 5432 (env=test)',
    `dbName=${dbInfo.dbName}, host=${dbInfo.host}, port=${dbInfo.port}, env=${dbInfo.env}`,
  );

  assertCheck(
    redisInfo.dbIndex === 1 &&
      redisInfo.port === '6379' &&
      (redisInfo.host === 'localhost' || redisInfo.host === '127.0.0.1'),
    'Redis isolation pre-flight: Target Redis is explicitly DB 1 on port 6379',
    `dbIndex=${redisInfo.dbIndex}, host=${redisInfo.host}, port=${redisInfo.port}`,
  );

  const testPrisma = new PrismaClient({
    datasources: { db: { url: TEST_DATABASE_URL } },
  });
  await testPrisma.$connect();

  const devPrisma = new PrismaClient({
    datasources: {
      db: { url: 'postgresql://postgres:postgres@localhost:5432/upsk_sdf?schema=public' },
    },
  });
  await devPrisma.$connect();

  // Snapshot dev row counts to prove dev DB remains untouched
  const devLinksBefore = await devPrisma.link.count();
  const devClicksBefore = await devPrisma.clickEvent.count();

  // Clear test DB tables before test execution
  await testPrisma.clickEvent.deleteMany({});
  await testPrisma.link.deleteMany({});

  // Connect to dev Redis (DB 0) and snapshot key count to prove DB 0 remains untouched
  const devRedis = new Redis('redis://localhost:6379/0', { maxRetriesPerRequest: 3 });
  await devRedis.ping();
  const devRedisKeysBefore = await devRedis.dbsize();

  // Verify Redis isolation on DB 1: only flush DB 1 (never FLUSHALL)
  const testRedis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: 3 });
  await testRedis.flushdb();
  const redisPing = await testRedis.ping();
  assertCheck(redisPing === 'PONG', 'Redis connection check: Connected to isolated Redis DB 1 and flushed DB 1 only');

  log('\n--- SECTION 1: Starting Isolated NestJS API Instance ---');
  const apiProc = await startApiServer(TEST_PORT);
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  log(`[SETUP] Test API server live at ${baseUrl}`);

  try {
    // Authenticate test principals
    const aliceToken = await login(baseUrl, 'alice@example.com', 'dev-alice-secret-01');
    const bobToken = await login(baseUrl, 'bob@example.com', 'dev-bob-secret-02');
    log('[AUTH] Alice & Bob authenticated successfully against test instance\n');

    log('--- SECTION 2: Official Acceptance Criteria Tests ---');

    // ------------------------------------------------------------------
    // TEST 1: Create Link (valid URL and normalized tags)
    // ------------------------------------------------------------------
    const createRes = await fetch(`${baseUrl}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        long_url: 'https://docs.example.com/getting-started/module-09?utm_source=test',
        tags: ['  Integration ', 'Testing', 'integration'],
      }),
    });
    const createdLink = (await createRes.json()) as {
      id: string;
      code: string;
      long_url: string;
      tags: string[];
      created_by: string;
    };

    assertCheck(
      createRes.status === 201 &&
        typeof createdLink.id === 'string' &&
        typeof createdLink.code === 'string' &&
        createdLink.long_url === 'https://docs.example.com/getting-started/module-09?utm_source=test' &&
        Array.isArray(createdLink.tags) &&
        createdLink.tags.length === 2 &&
        createdLink.tags.includes('integration') &&
        createdLink.tags.includes('testing') &&
        createdLink.created_by === 'principal_a',
      'CRITERION 1: Create Link persists valid URL, normalizes/deduplicates tags, and returns 201',
      `status=${createRes.status}, code=${createdLink.code}, tags=${JSON.stringify(createdLink.tags)}`,
    );

    // ------------------------------------------------------------------
    // TEST 2: Redirect Correctness (HTTP 302, Location header matching long_url)
    // ------------------------------------------------------------------
    const redirectRes = await fetch(`${baseUrl}/r/${createdLink.code}`, {
      redirect: 'manual',
    });
    const locationHeader = redirectRes.headers.get('location');

    assertCheck(
      redirectRes.status === 302 &&
        locationHeader === 'https://docs.example.com/getting-started/module-09?utm_source=test',
      'CRITERION 2: Redirect correctness: GET /r/:code returns HTTP 302 with exact Location header',
      `status=${redirectRes.status}, location=${locationHeader}`,
    );

    // ------------------------------------------------------------------
    // TEST 3: Authentication Protection (Missing/Invalid JWT returns 401)
    // ------------------------------------------------------------------
    const noTokenRes = await fetch(`${baseUrl}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ long_url: 'https://example.org/test' }),
    });
    const badTokenRes = await fetch(`${baseUrl}/links`, {
      headers: { Authorization: 'Bearer invalid.bogus.jwt' },
    });
    const noTokenBody = (await noTokenRes.json()) as { error?: { code?: string } };

    assertCheck(
      noTokenRes.status === 401 &&
        badTokenRes.status === 401 &&
        noTokenBody.error?.code === 'UNAUTHORIZED',
      'CRITERION 3: Authentication protection: Protected endpoints reject missing/invalid JWT with 401',
      `noTokenStatus=${noTokenRes.status}, badTokenStatus=${badTokenRes.status}, code=${noTokenBody.error?.code}`,
    );

    // ------------------------------------------------------------------
    // TEST 4: Authorization / IDOR Protection (404 on other user's resource)
    // ------------------------------------------------------------------
    // Bob attempts to GET, PATCH, and DELETE Alice's link
    const bobGetRes = await fetch(`${baseUrl}/links/${createdLink.id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    const bobPatchRes = await fetch(`${baseUrl}/links/${createdLink.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({ long_url: 'https://attacker.example.com' }),
    });
    const bobDeleteRes = await fetch(`${baseUrl}/links/${createdLink.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${bobToken}` },
    });

    assertCheck(
      bobGetRes.status === 404 && bobPatchRes.status === 404 && bobDeleteRes.status === 404,
      'CRITERION 4: Authorization / IDOR protection: Cross-owner read/update/delete returns 404',
      `get=${bobGetRes.status}, patch=${bobPatchRes.status}, delete=${bobDeleteRes.status}`,
    );

    // Verify Alice's link was NOT altered by Bob's patch
    const aliceVerifyRes = await fetch(`${baseUrl}/links/${createdLink.id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const aliceLinkCurrent = (await aliceVerifyRes.json()) as { long_url: string };
    assertCheck(
      aliceLinkCurrent.long_url === 'https://docs.example.com/getting-started/module-09?utm_source=test',
      'CRITERION 4 (Integrity): Attacker patch attempt did not modify owner resource in database',
      `long_url=${aliceLinkCurrent.long_url}`,
    );

    // ------------------------------------------------------------------
    // TEST 5: Retention Enforcement (Purge / Filter behavior)
    // ------------------------------------------------------------------
    // Insert 2 click events in test database: one recent, one 45 days old
    const now = new Date();
    const oldDate = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);

    await testPrisma.clickEvent.createMany({
      data: [
        {
          idempotencyKey: `click_recent_${Date.now()}`,
          linkId: createdLink.id,
          clickedAt: now,
          userAgent: 'TestAgent/1.0',
          referrer: 'direct',
          ipHash: 'a'.repeat(64),
        },
        {
          idempotencyKey: `click_old_${Date.now()}`,
          linkId: createdLink.id,
          clickedAt: oldDate,
          userAgent: 'OldAgent/1.0',
          referrer: 'old-campaign',
          ipHash: 'b'.repeat(64),
        },
      ],
    });

    const clicksBeforePurge = await testPrisma.clickEvent.count({
      where: { linkId: createdLink.id },
    });

    // Run purge process with 30-day retention on test database
    const apiDir = path.resolve(__dirname, '..');
    const purgeProc = spawn(process.execPath, [path.join(apiDir, 'dist/purge.js')], {
      cwd: apiDir,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: TEST_DATABASE_URL,
        REDIS_URL: TEST_REDIS_URL,
        ANALYTICS_RETENTION_DAYS: '30',
      },
    });
    await new Promise<void>((resolve) => purgeProc.once('exit', () => resolve()));

    const clicksAfterPurge = await testPrisma.clickEvent.count({
      where: { linkId: createdLink.id },
    });
    const purgedCount = clicksBeforePurge - clicksAfterPurge;

    assertCheck(
      clicksBeforePurge === 2 && purgedCount === 1 && clicksAfterPurge === 1,
      'CRITERION 5: Retention enforcement: Purge CLI cleans records older than retention period',
      `before=${clicksBeforePurge}, purged=${purgedCount}, remaining=${clicksAfterPurge}`,
    );

    // ------------------------------------------------------------------
    // TEST 6: URL Validation Regression (Credential & bypass rejection)
    // ------------------------------------------------------------------
    const bypassInputs = [
      'https://user:password@evil.example.com',
      'http://attacker.com@legitimate.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://',
      'ftp://example.com/file',
      'https://',
    ];

    let allBypassesRejected = true;
    for (const url of bypassInputs) {
      const res = await fetch(`${baseUrl}/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ long_url: url }),
      });
      if (res.status !== 400) {
        allBypassesRejected = false;
        log(`[FAIL] Bypass URL was not rejected with 400: ${url} (got ${res.status})`);
      }
    }

    assertCheck(
      allBypassesRejected,
      'CRITERION 6: URL validation regression: Malicious, credential-containing and non-HTTP URLs rejected with 400',
      `tested=${bypassInputs.length}/7 bypass strings rejected`,
    );

    // ------------------------------------------------------------------
    // TEST 7: Analytics Asynchronous Queueing & Idempotency
    // ------------------------------------------------------------------
    const analyticsService = new AnalyticsService(testPrisma as any);
    const idempotencyKey = `idemp_app_${Date.now()}`;
    const clickJobPayload: ClickEventJobPayload = {
      eventId: idempotencyKey,
      code: createdLink.code,
      linkId: createdLink.id,
      clickedAt: new Date().toISOString(),
      userAgent: 'Module09-IntegrationTester/1.0',
      referrer: 'https://search.example.com',
      ipHash: 'c'.repeat(64),
    };

    // First persistence via AnalyticsService application logic: must succeed
    const firstResult = await analyticsService.persistClickEvent(clickJobPayload);

    // Second persistence with identical eventId: must return duplicate_ignored without double counting
    const secondResult = await analyticsService.persistClickEvent(clickJobPayload);

    // Direct database uniqueness constraint verification: raw insert must trigger P2002
    let dbConstraintTriggered = false;
    try {
      await testPrisma.clickEvent.create({
        data: {
          idempotencyKey,
          linkId: createdLink.id,
          clickedAt: new Date(),
          userAgent: 'DirectDuplicate/1.0',
          referrer: 'direct',
          ipHash: 'd'.repeat(64),
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        dbConstraintTriggered = true;
      }
    }

    const idempotentClicksCount = await testPrisma.clickEvent.count({
      where: { idempotencyKey },
    });

    assertCheck(
      firstResult.status === 'persisted' &&
        secondResult.status === 'duplicate_ignored' &&
        dbConstraintTriggered &&
        idempotentClicksCount === 1,
      'CRITERION 7: Analytics idempotency: Application processing catches duplicate and returns duplicate_ignored, backed by P2002 constraint with count=1',
      `firstStatus=${firstResult.status}, secondStatus=${secondResult.status}, dbP2002=${dbConstraintTriggered}, totalCount=${idempotentClicksCount}`,
    );

    // ------------------------------------------------------------------
    // FINAL SAFETY PROOF: Development Database & Redis DB 0 were NOT modified
    // ------------------------------------------------------------------
    const devLinksAfter = await devPrisma.link.count();
    const devClicksAfter = await devPrisma.clickEvent.count();

    assertCheck(
      devLinksBefore === devLinksAfter && devClicksBefore === devClicksAfter,
      'SAFETY VERIFICATION: Development database (upsk_sdf) row count unchanged (zero cross-database leaks)',
      `links=${devLinksBefore}->${devLinksAfter}, clicks=${devClicksBefore}->${devClicksAfter}`,
    );

    const devRedisKeysAfter = await devRedis.dbsize();
    assertCheck(
      devRedisKeysBefore === devRedisKeysAfter,
      'SAFETY VERIFICATION: Development Redis DB 0 key count unchanged (zero cross-database leaks)',
      `db0Keys=${devRedisKeysBefore}->${devRedisKeysAfter}`,
    );
  } finally {
    log('\n[TEARDOWN] Stopping test API instance and disconnecting test clients...');
    await stopProcess(apiProc);
    testRedis.disconnect();
    devRedis.disconnect();
    await testPrisma.$disconnect();
    await devPrisma.$disconnect();
  }

  log('\n====================================================================');
  log(`SUMMARY: passed=${passed}, failed=${failures.length}`);
  log('====================================================================');
  log(`Evidence saved to: ${summaryLogFile}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('Fatal error in Module 09 test runner:', err);
  process.exit(1);
});
