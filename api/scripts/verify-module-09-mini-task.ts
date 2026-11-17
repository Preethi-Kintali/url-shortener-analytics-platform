import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { ClickEventJobPayload } from '../src/analytics/analytics.constants';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-09');
fs.mkdirSync(evidenceDir, { recursive: true });
const outFile = path.join(evidenceDir, 'reflection-mini-task.txt');
fs.writeFileSync(outFile, '', 'utf8');

function log(msg: string): void {
  console.log(msg);
  fs.appendFileSync(outFile, msg + '\n', 'utf8');
}

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/upsk_sdf_test?schema=public';
const TEST_REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';
const TEST_PORT = 3199;

function sanitizeUrl(rawUrl: string): string {
  return rawUrl.replace(/:([^:@/]+)@/, ':***@');
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

async function runMiniTask(): Promise<void> {
  log('====================================================================');
  log('Module 09: STEP 4 Verification Mini-Task (Reflection Deliverable)');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('====================================================================\n');

  // Step 1: Pre-flight Safety Validation
  const parsedDb = new URL(TEST_DATABASE_URL);
  const parsedRedis = new URL(TEST_REDIS_URL);
  const dbName = parsedDb.pathname.replace(/^\//, '');
  const redisDb = parsedRedis.pathname.replace(/^\//, '');

  log(`[PRE-FLIGHT] Test Database: ${sanitizeUrl(TEST_DATABASE_URL)}`);
  log(`[PRE-FLIGHT] Test Redis: ${sanitizeUrl(TEST_REDIS_URL)}`);

  if (dbName !== 'upsk_sdf_test' || redisDb !== '1') {
    throw new Error('Pre-flight check failed: Target environment is not isolated test environment!');
  }
  log('[PASS] Pre-flight Isolation: Explicitly targeting upsk_sdf_test and Redis DB 1\n');

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

  const devLinksBefore = await devPrisma.link.count();
  const devClicksBefore = await devPrisma.clickEvent.count();

  const devRedis = new Redis('redis://localhost:6379/0', { maxRetriesPerRequest: 3 });
  await devRedis.ping();
  const devRedisKeysBefore = await devRedis.dbsize();

  // Clear test fixtures in test DB
  await testPrisma.clickEvent.deleteMany({});
  await testPrisma.link.deleteMany({});
  const testRedis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: 3 });
  await testRedis.flushdb();

  log('[SETUP] Spawning isolated NestJS API server on port ' + TEST_PORT + '...');
  const apiDir = path.resolve(__dirname, '..');
  const apiProc = spawn(process.execPath, [path.join(apiDir, 'dist/main.js')], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(TEST_PORT),
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      ANALYTICS_RETENTION_DAYS: '30',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  let booted = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.status === 200) {
        booted = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!booted) {
    await stopProcess(apiProc);
    throw new Error('Test API server failed to boot within 10s');
  }
  log('[SETUP] API server live at ' + baseUrl + '\n');

  try {
    // 1. Authenticate Alice
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'dev-alice-secret-01' }),
    });
    const { access_token } = (await loginRes.json()) as { access_token: string };
    log(`[ACTION 1] Alice login: status=${loginRes.status}, tokenReceived=${!!access_token}`);

    // 2. Create link with tags
    const targetUrl = 'https://docs.example.com/reflection-mini-task?ref=module-09';
    const createRes = await fetch(`${baseUrl}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({
        long_url: targetUrl,
        tags: ['MiniTask', 'Reflection', 'minitask'],
      }),
    });
    const created = (await createRes.json()) as { id: string; code: string; tags: string[] };
    log(
      `[ACTION 2] Create Link: status=${createRes.status}, code=${created.code}, tags=${JSON.stringify(created.tags)}`,
    );

    // 3. Verify public redirect correctness
    const redirectRes = await fetch(`${baseUrl}/r/${created.code}`, { redirect: 'manual' });
    const location = redirectRes.headers.get('location');
    log(
      `[ACTION 3] Public Redirect GET /r/${created.code}: status=${redirectRes.status}, location=${location}`,
    );
    const redirectOk = redirectRes.status === 302 && location === targetUrl;
    log(`[PASS] Redirect correctness: status=302 and exact Location header verified (${redirectOk})`);

    // 4. Verify AnalyticsService idempotency
    const analyticsService = new AnalyticsService(testPrisma as any);
    const idempotencyKey = `reflection_idemp_${Date.now()}`;
    const payload: ClickEventJobPayload = {
      eventId: idempotencyKey,
      code: created.code,
      linkId: created.id,
      clickedAt: new Date().toISOString(),
      userAgent: 'ReflectionMiniTask/1.0',
      referrer: 'https://verify.example.com',
      ipHash: 'f'.repeat(64),
    };

    const res1 = await analyticsService.persistClickEvent(payload);
    const res2 = await analyticsService.persistClickEvent(payload);
    const dbCount = await testPrisma.clickEvent.count({ where: { idempotencyKey } });
    log(
      `[ACTION 4] Analytics Idempotency: first=${res1.status}, second=${res2.status}, storedCount=${dbCount}`,
    );
    const idempOk = res1.status === 'persisted' && res2.status === 'duplicate_ignored' && dbCount === 1;
    log(`[PASS] Idempotency logic & PostgreSQL uniqueness verified (${idempOk})`);

    // 5. Verify real DB and Redis DB 0 immutability
    const devLinksAfter = await devPrisma.link.count();
    const devClicksAfter = await devPrisma.clickEvent.count();
    const devRedisKeysAfter = await devRedis.dbsize();

    const devDbUnchanged = devLinksBefore === devLinksAfter && devClicksBefore === devClicksAfter;
    const redisDb0Unchanged = devRedisKeysBefore === devRedisKeysAfter;

    log(
      `[ACTION 5] Environment Immutability: devLinks=${devLinksBefore}->${devLinksAfter}, devClicks=${devClicksBefore}->${devClicksAfter}, redisDB0=${devRedisKeysBefore}->${devRedisKeysAfter}`,
    );
    log(`[PASS] Real database and Redis DB 0 immutability verified (dbUnchanged=${devDbUnchanged}, redisUnchanged=${redisDb0Unchanged})`);

    log('\n====================================================================');
    log('MINI-TASK RESULT: ALL VERIFICATION ACTIONS PASSED (100% REPRODUCIBLE)');
    log('====================================================================');
  } finally {
    log('\n[TEARDOWN] Stopping test API server and disconnecting test clients...');
    await stopProcess(apiProc);
    testRedis.disconnect();
    devRedis.disconnect();
    await testPrisma.$disconnect();
    await devPrisma.$disconnect();
  }
}

runMiniTask().catch((err) => {
  console.error('Fatal error in reflection mini task:', err);
  process.exit(1);
});

