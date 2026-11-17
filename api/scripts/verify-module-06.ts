import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import Redis from 'ioredis';
import { RedisCacheService } from '../src/cache/redis-cache.service';
import { redactSensitiveText, sanitizeValue } from '../src/common/logging/redaction.util';
import { StructuredLoggerService } from '../src/common/logging/structured-logger.service';
import { LinksService } from '../src/links/links.service';
import { PrismaService } from '../src/prisma/prisma.service';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-06');
fs.mkdirSync(evidenceDir, { recursive: true });
const logFile = path.join(evidenceDir, 'redis-cache-tests.txt');
fs.writeFileSync(logFile, '', 'utf8');

let assertionsPassed = 0;
const failures: string[] = [];

function log(msg: string): void {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n', 'utf8');
}

function assertCheck(condition: boolean, label: string, details?: string): void {
  if (condition) {
    assertionsPassed++;
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

async function stopServer(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.killed) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore cleanup errors
      }
      resolve();
    }, 3000);

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

interface SpawnedServer {
  process: ChildProcess;
  stdoutLines: string[];
  stderrLines: string[];
  allOutput: () => string;
}

async function startApiServer(
  envOverrides?: Record<string, string>,
  port = 3000,
): Promise<SpawnedServer> {
  const apiDir = path.resolve(__dirname, '..');
  const serverScript = path.join(apiDir, 'dist', 'main.js');
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const proc = spawn('node', [serverScript], {
    cwd: apiDir,
    stdio: 'pipe',
    shell: false,
    env: {
      ...process.env,
      PORT: String(port),
      ...envOverrides,
    },
  });

  let stdoutBuf = '';
  proc.stdout?.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    const parts = stdoutBuf.split(/\r?\n/);
    stdoutBuf = parts.pop() || '';
    stdoutLines.push(...parts.filter((line) => line.length > 0));
  });

  let stderrBuf = '';
  proc.stderr?.on('data', (chunk) => {
    stderrBuf += chunk.toString('utf8');
    const parts = stderrBuf.split(/\r?\n/);
    stderrBuf = parts.pop() || '';
    stderrLines.push(...parts.filter((line) => line.length > 0));
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.status === 200) {
        healthy = true;
        break;
      }
    } catch {
      // Starting up
    }
  }

  if (!healthy) {
    await stopServer(proc);
    throw new Error(`Server failed to become healthy on port ${port}`);
  }

  return {
    process: proc,
    stdoutLines,
    stderrLines,
    allOutput: () => [...stdoutLines, stdoutBuf, ...stderrLines, stderrBuf].filter(Boolean).join('\n'),
  };
}

function parseJsonLogLines(rawOutput: string): Array<Record<string, unknown>> {
  const parsed: Array<Record<string, unknown>> = [];
  for (const line of rawOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      parsed.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // Ignore non-JSON lines
    }
  }
  return parsed;
}

async function loginAlice(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'alice@example.com',
      password: 'dev-alice-secret-01',
    }),
  });
  const body = (await res.json()) as { access_token?: string };
  if (res.status !== 200 || !body.access_token) {
    throw new Error(`Alice login failed with status ${res.status}`);
  }
  return body.access_token;
}

async function run(): Promise<void> {
  log('====================================================================');
  log('Module 06: Redis Cache-Aside, Invalidation, Fallback & Throttle Suite');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('====================================================================\n');

  const probeRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 1000,
    maxRetriesPerRequest: 0,
  });
  probeRedis.on('error', () => {});

  try {
    await probeRedis.connect();
    const pingReply = await probeRedis.ping();
    assertCheck(
      pingReply === 'PONG',
      'Dedicated bootcamp-redis responds to PING',
      `reply=${pingReply}`,
    );

    // SECTION 0: Unit verification (no DB query on cache hit, safe fallback on Redis failure, redaction)
    log('\n--- SECTION 0: Cache-Aside & Redaction Unit Checks ---');

    const redisSecretSample = 'Failed redis://:top-secret-redis-pass@127.0.0.1:6379 connect';
    const redactedRedisText = redactSensitiveText(redisSecretSample);
    const redactedUrlObj = JSON.stringify(
      sanitizeValue({
        event: 'test',
        long_url: 'https://secret.example.org/private-path',
        redis_url: 'redis://:pw@localhost:6379',
      }),
    );
    assertCheck(
      !redactedRedisText.includes('top-secret-redis-pass') &&
        !redactedUrlObj.includes('https://secret.example.org/private-path') &&
        !redactedUrlObj.includes('pw'),
      'Redaction utility masks Redis credentials and destination URL object keys',
      `redisText=${redactedRedisText}`,
    );

    let prismaFindUniqueCalls = 0;
    const mockPrismaHit = {
      link: {
        findUnique: async () => {
          prismaFindUniqueCalls++;
          return { code: 'unitHit1', longUrl: 'https://db-should-not-run.example' };
        },
        updateMany: async () => ({ count: 1 }),
        findFirst: async () => ({
          id: 'id-1',
          code: 'unitHit1',
          longUrl: 'https://updated.example.com',
          createdAt: new Date(),
          createdBy: 'principal_a',
        }),
        deleteMany: async () => ({ count: 1 }),
      },
    } as unknown as PrismaService;

    const invalidatedCodes: string[] = [];
    const mockCacheHitAndFailInvalidate = {
      getDefaultTtlSeconds: () => 300,
      getRedirectTarget: async (code: string) =>
        code === 'unitHit1' ? 'https://cached-target.example.com/ok' : null,
      setRedirectTarget: async () => true,
      invalidateRedirectTarget: async (code: string) => {
        invalidatedCodes.push(code);
        return false; // Simulate failed Redis DEL without throwing
      },
    } as unknown as RedisCacheService;

    const unitLinksService = new LinksService(mockPrismaHit, mockCacheHitAndFailInvalidate);
    const unitHitResult = await unitLinksService.findByCode('unitHit1');
    assertCheck(
      unitHitResult.long_url === 'https://cached-target.example.com/ok' && prismaFindUniqueCalls === 0,
      'Cache HIT returns target from Redis without calling PostgreSQL',
      `prismaFindUniqueCalls=${prismaFindUniqueCalls}`,
    );

    const unitPatchResult = await unitLinksService.update(
      'id-1',
      { long_url: 'https://updated.example.com' },
      'principal_a',
    );
    const unitDeleteResult = await unitLinksService.remove('id-1', 'principal_a');
    assertCheck(
      unitPatchResult.code === 'unitHit1' &&
        unitDeleteResult.deleted === true &&
        invalidatedCodes.length === 2 &&
        invalidatedCodes[0] === 'unitHit1' &&
        invalidatedCodes[1] === 'unitHit1',
      'Failed Redis invalidation does not fail PostgreSQL PATCH or DELETE writes and retrieves code before DELETE',
      `invalidatedCodes=[${invalidatedCodes.join(',')}]`,
    );

    // Invalid REDIS_URL constructor resilience
    const prevRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = 'not-a-valid-redis-url';
    const capturedConfigLogs: Array<Record<string, unknown>> = [];
    const capturingLogger = {
      log: (m: unknown) => {
        if (typeof m === 'object' && m) capturedConfigLogs.push(m as Record<string, unknown>);
      },
      warn: (m: unknown) => {
        if (typeof m === 'object' && m) capturedConfigLogs.push(m as Record<string, unknown>);
      },
      error: (m: unknown) => {
        if (typeof m === 'object' && m) capturedConfigLogs.push(m as Record<string, unknown>);
      },
    } as unknown as StructuredLoggerService;
    const degradedCache = new RedisCacheService(capturingLogger);
    await degradedCache.onModuleInit();
    const getNull = await degradedCache.getRedirectTarget('unitCode');
    const setFalse = await degradedCache.setRedirectTarget('unitCode', 'https://example.com', 300);
    const delFalse = await degradedCache.invalidateRedirectTarget('unitCode');
    await degradedCache.onModuleDestroy();
    if (prevRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedisUrl;

    assertCheck(
      getNull === null &&
        setFalse === false &&
        delFalse === false &&
        capturedConfigLogs.some((e) => e.event === 'redis_config_invalid') &&
        capturedConfigLogs.some((e) => e.event === 'cache_redis_fallback') &&
        capturedConfigLogs.some((e) => e.event === 'cache_invalidation_failed'),
      'Invalid REDIS_URL degrades gracefully without crashing or throwing',
    );

    // Single-flight cache stampede prevention & cross-key independence (unit)
    const sfCounts = {
      hotDb: 0,
      otherDb: 0,
      hotSets: 0,
      otherSets: 0,
    };
    let lastHotTtl = 0;
    const sfPrisma = {
      link: {
        findUnique: async (args: { where: { code: string } }) => {
          const c = args.where.code;
          await sleep(40);
          if (c === 'hotUnitKey') {
            sfCounts.hotDb++;
            return { code: c, longUrl: 'https://hot.example.com/target' };
          }
          if (c === 'otherUnitKey') {
            sfCounts.otherDb++;
            return { code: c, longUrl: 'https://other.example.com/target' };
          }
          return null;
        },
      },
    } as unknown as PrismaService;
    const sfCache = {
      getDefaultTtlSeconds: () => 300,
      getRedirectTarget: async () => null,
      setRedirectTarget: async (code: string, _url: string, ttlSeconds?: number) => {
        if (code === 'hotUnitKey') {
          sfCounts.hotSets++;
          lastHotTtl = ttlSeconds ?? 0;
        } else if (code === 'otherUnitKey') {
          sfCounts.otherSets++;
        }
        return true;
      },
      invalidateRedirectTarget: async () => true,
    } as unknown as RedisCacheService;
    const sfLogs: Array<Record<string, unknown>> = [];
    const sfLogger = {
      log: (m: unknown) => {
        if (typeof m === 'object' && m) sfLogs.push(m as Record<string, unknown>);
      },
      warn: (m: unknown) => {
        if (typeof m === 'object' && m) sfLogs.push(m as Record<string, unknown>);
      },
      error: (m: unknown) => {
        if (typeof m === 'object' && m) sfLogs.push(m as Record<string, unknown>);
      },
    } as unknown as StructuredLoggerService;

    const sfService = new LinksService(sfPrisma, sfCache, sfLogger);
    const [otherRes, ...hotResults] = await Promise.all([
      sfService.findByCode('otherUnitKey'),
      ...Array.from({ length: 25 }, () => sfService.findByCode('hotUnitKey')),
    ]);
    const coalescedHotLogs = sfLogs.filter(
      (e) => e.event === 'cache_miss_coalesced' && e.code === 'hotUnitKey',
    );
    assertCheck(
      hotResults.length === 25 &&
        hotResults.every((r) => r.long_url === 'https://hot.example.com/target') &&
        otherRes.long_url === 'https://other.example.com/target' &&
        sfCounts.hotDb === 1 &&
        sfCounts.hotSets === 1 &&
        sfCounts.otherDb === 1 &&
        sfCounts.otherSets === 1 &&
        coalescedHotLogs.length === 24 &&
        lastHotTtl > 0 &&
        lastHotTtl <= 300,
      'Single-flight coalesces 25 concurrent misses to 1 DB read + 1 Redis write without blocking distinct keys',
      `hotDb=${sfCounts.hotDb}, hotSets=${sfCounts.hotSets}, otherDb=${sfCounts.otherDb}, coalesced=${coalescedHotLogs.length}, ttl=${lastHotTtl}`,
    );

    // Pre-mutation in-flight stale write guard (unit)
    const staleWriteAttempts: Array<{ code: string; url: string }> = [];
    const staleInvalidations: string[] = [];
    const racePrisma = {
      link: {
        findUnique: async (args: { where: { code: string } }) => {
          await sleep(40);
          return { code: args.where.code, longUrl: 'https://stale-before-patch.example.com' };
        },
        updateMany: async () => ({ count: 1 }),
        findFirst: async () => ({
          id: 'race-id',
          code: 'raceKey',
          longUrl: 'https://fresh-after-patch.example.com',
          createdAt: new Date(),
          createdBy: 'principal_a',
        }),
      },
    } as unknown as PrismaService;
    const raceCache = {
      getDefaultTtlSeconds: () => 300,
      getRedirectTarget: async () => null,
      setRedirectTarget: async (code: string, url: string) => {
        staleWriteAttempts.push({ code, url });
        return true;
      },
      invalidateRedirectTarget: async (code: string) => {
        staleInvalidations.push(code);
        return true;
      },
    } as unknown as RedisCacheService;
    const raceService = new LinksService(racePrisma, raceCache, sfLogger);
    const inFlightReadPromise = raceService.findByCode('raceKey');
    await sleep(10);
    await raceService.update(
      'race-id',
      { long_url: 'https://fresh-after-patch.example.com' },
      'principal_a',
    );
    await inFlightReadPromise;
    assertCheck(
      staleInvalidations.includes('raceKey') && staleWriteAttempts.length === 0,
      'In-flight cache miss superseded by PATCH update never repopulates Redis with stale destination URL',
      `invalidations=${staleInvalidations.length}, staleWrites=${staleWriteAttempts.length}`,
    );

    // SECTION A: Live Cache-Aside Flow (MISS -> Populate -> HIT -> PATCH Invalidate -> DELETE Invalidate -> 404)
    log('\n--- SECTION A: Live Cache-Aside, Invalidation & Rate-Limit Order (Port 3000) ---');
    const server1 = await startApiServer({ PORT: '3000', REDIS_URL: 'redis://localhost:6379' }, 3000);
    const base1 = 'http://127.0.0.1:3000';
    let aliceToken1 = '';

    try {
      aliceToken1 = await loginAlice(base1);

      const initialLongUrl = 'https://example.com/m6-secret-initial-destination';
      const updatedLongUrl = 'https://example.org/m6-secret-updated-destination';

      const createRes = await fetch(`${base1}/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken1}`,
        },
        body: JSON.stringify({ long_url: initialLongUrl }),
      });
      const created = (await createRes.json()) as { id: string; code: string; long_url: string };
      assertCheck(
        createRes.status === 201 && typeof created.code === 'string' && typeof created.id === 'string',
        'Create test link for Module 06 cache flow (201)',
        `id=${created.id}, code=${created.code}`,
      );

      const cacheKey = `redirect:v1:${created.code}`;
      await probeRedis.del(cacheKey);
      const beforeFirstValue = await probeRedis.get(cacheKey);
      assertCheck(beforeFirstValue === null, 'Redis key is absent before first redirect', `key=${cacheKey}`);

      // First redirect -> Cache MISS -> Query Postgres -> Populate Redis -> 302
      const reqIdMiss = 'req-m6-cache-miss-01';
      const missRes = await fetch(`${base1}/r/${created.code}`, {
        redirect: 'manual',
        headers: { 'X-Request-Id': reqIdMiss },
      });
      const missLoc = missRes.headers.get('location');
      await sleep(50);

      const cachedAfterMiss = await probeRedis.get(cacheKey);
      const ttlAfterMiss = await probeRedis.ttl(cacheKey);
      assertCheck(
        missRes.status === 302 &&
          missLoc === initialLongUrl &&
          cachedAfterMiss === initialLongUrl &&
          ttlAfterMiss > 0 &&
          ttlAfterMiss <= 300,
        'First GET /r/:code misses cache, returns 302 from PostgreSQL, and populates Redis with bounded TTL',
        `status=${missRes.status}, ttl=${ttlAfterMiss}s`,
      );

      // Second redirect -> Cache HIT -> 302
      const reqIdHit = 'req-m6-cache-hit-02';
      const hitRes = await fetch(`${base1}/r/${created.code}`, {
        redirect: 'manual',
        headers: { 'X-Request-Id': reqIdHit },
      });
      const hitLoc = hitRes.headers.get('location');
      await sleep(50);

      assertCheck(
        hitRes.status === 302 && hitLoc === initialLongUrl,
        'Second GET /r/:code returns 302 from Redis cache HIT',
        `status=${hitRes.status}`,
      );

      // PATCH update invalidates cache
      const reqIdPatch = 'req-m6-patch-inv-03';
      const patchRes = await fetch(`${base1}/links/${created.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken1}`,
          'X-Request-Id': reqIdPatch,
        },
        body: JSON.stringify({ long_url: updatedLongUrl }),
      });
      await sleep(50);
      const valueAfterPatch = await probeRedis.get(cacheKey);
      assertCheck(
        patchRes.status === 200 && valueAfterPatch === null,
        'PATCH /links/:id commits to PostgreSQL and invalidates old Redis cache key',
        `status=${patchRes.status}, keyValue=${String(valueAfterPatch)}`,
      );

      // Redirect after PATCH returns NEW URL (miss -> DB -> repopulates Redis)
      const afterPatchRes = await fetch(`${base1}/r/${created.code}`, {
        redirect: 'manual',
        headers: { 'X-Request-Id': 'req-m6-after-patch-04' },
      });
      const afterPatchLoc = afterPatchRes.headers.get('location');
      await sleep(50);
      const cachedAfterPatchRedirect = await probeRedis.get(cacheKey);
      assertCheck(
        afterPatchRes.status === 302 &&
          afterPatchLoc === updatedLongUrl &&
          cachedAfterPatchRedirect === updatedLongUrl,
        'GET /r/:code after PATCH redirects to updated URL and repopulates Redis',
        `status=${afterPatchRes.status}`,
      );

      // DELETE invalidates cache & subsequent redirect returns 404
      const reqIdDel = 'req-m6-del-inv-05';
      const delRes = await fetch(`${base1}/links/${created.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${aliceToken1}`,
          'X-Request-Id': reqIdDel,
        },
      });
      await sleep(50);
      const valueAfterDelete = await probeRedis.get(cacheKey);
      const afterDeleteRedir = await fetch(`${base1}/r/${created.code}`, {
        redirect: 'manual',
        headers: { 'X-Request-Id': 'req-m6-after-del-06' },
      });
      assertCheck(
        delRes.status === 200 && valueAfterDelete === null && afterDeleteRedir.status === 404,
        'DELETE /links/:id invalidates Redis cache and subsequent GET /r/:code returns 404',
        `deleteStatus=${delRes.status}, keyValue=${String(valueAfterDelete)}, redirectAfterDelete=${afterDeleteRedir.status}`,
      );

      // Unknown code -> 404
      const unknownRes = await fetch(`${base1}/r/unknown_m6_code_99`, { redirect: 'manual' });
      assertCheck(
        unknownRes.status === 404,
        'GET /r/:code for unknown code returns 404',
        `status=${unknownRes.status}`,
      );

      // Redirect Rate Limit (120/min) BEFORE cache lookup, including Redis cache HITs
      const rateCreateRes = await fetch(`${base1}/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken1}`,
        },
        body: JSON.stringify({ long_url: 'https://example.com/m6-rate-limit-secret-path' }),
      });
      const rateLink = (await rateCreateRes.json()) as { id: string; code: string };

      const priorRedirects = 5;
      const expectedRemainingAllowed = 120 - priorRedirects;
      let allowed302 = 0;
      let throttled429 = 0;
      const tailStatuses: number[] = [];

      for (let i = 0; i < expectedRemainingAllowed + 5; i++) {
        const rRes = await fetch(`${base1}/r/${rateLink.code}`, { redirect: 'manual' });
        tailStatuses.push(rRes.status);
        if (i < expectedRemainingAllowed && rRes.status === 302) {
          allowed302++;
        } else if (i >= expectedRemainingAllowed && rRes.status === 429) {
          throttled429++;
        }
      }

      await sleep(80);
      const s1Logs = parseJsonLogLines(server1.allOutput());
      const rateCodeHitLogs = s1Logs.filter(
        (entry) => entry.event === 'cache_hit' && entry.code === rateLink.code,
      );
      const rateCodeMissLogs = s1Logs.filter(
        (entry) => entry.event === 'cache_miss' && entry.code === rateLink.code,
      );

      assertCheck(
        allowed302 === expectedRemainingAllowed &&
          throttled429 === 5 &&
          rateCodeMissLogs.length === 1 &&
          rateCodeHitLogs.length === expectedRemainingAllowed - 1,
        'Redirect 120 req/min throttling enforces HTTP 429 on Redis cache HITs BEFORE cache lookup',
        `allowed302=${allowed302}/${expectedRemainingAllowed}, blocked429=${throttled429}, misses=${rateCodeMissLogs.length}, hits=${rateCodeHitLogs.length}, tail=[${tailStatuses.slice(-8).join(',')}]`,
      );

      const missSample = s1Logs.find(
        (entry) =>
          entry.event === 'cache_miss' &&
          entry.code === created.code &&
          entry.request_id === reqIdMiss,
      );
      const hitSample = s1Logs.find(
        (entry) =>
          entry.event === 'cache_hit' &&
          entry.code === created.code &&
          entry.request_id === reqIdHit,
      );
      assertCheck(
        Boolean(missSample) && Boolean(hitSample),
        'Structured logs emit cache_miss and cache_hit correlated with X-Request-Id',
      );
      if (missSample) log(`   Sample cache_miss log: ${JSON.stringify(missSample)}`);
      if (hitSample) log(`   Sample cache_hit log: ${JSON.stringify(hitSample)}`);

      await fetch(`${base1}/links/${rateLink.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${aliceToken1}` },
      });

      const rawS1 = server1.allOutput();
      assertCheck(
        !rawS1.includes(initialLongUrl) &&
          !rawS1.includes(updatedLongUrl) &&
          !rawS1.includes('m6-rate-limit-secret-path') &&
          !rawS1.includes('dev-alice-secret-01') &&
          !rawS1.includes(aliceToken1) &&
          !rawS1.includes('alice@example.com'),
        'Server logs never expose destination URLs, JWTs, passwords, or PII (Server #1)',
      );
    } finally {
      await stopServer(server1.process);
    }

    // SECTION B: Broken REDIS_URL Graceful Fallback & Invalidation Failure Isolation (Port 3106)
    log('\n--- SECTION B: Broken REDIS_URL Graceful Fallback & Write Resilience (Port 3106) ---');
    const server2 = await startApiServer(
      { PORT: '3106', REDIS_URL: 'redis://:secret-redis-pw@127.0.0.1:6399' },
      3106,
    );
    const base2 = 'http://127.0.0.1:3106';
    let aliceToken2 = '';

    try {
      const healthRes = await fetch(`${base2}/health`);
      assertCheck(
        healthRes.status === 200,
        'API boots cleanly and GET /health returns 200 even when REDIS_URL points to unreachable Redis',
        `status=${healthRes.status}`,
      );

      aliceToken2 = await loginAlice(base2);
      const fbUrl1 = 'https://example.com/m6-fallback-initial-secret';
      const fbUrl2 = 'https://example.org/m6-fallback-updated-secret';

      const fbCreateRes = await fetch(`${base2}/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken2}`,
        },
        body: JSON.stringify({ long_url: fbUrl1 }),
      });
      const fbLink = (await fbCreateRes.json()) as { id: string; code: string };

      const fbRedirect1 = await fetch(`${base2}/r/${fbLink.code}`, {
        redirect: 'manual',
        headers: { 'X-Request-Id': 'req-m6-fb-redir-01' },
      });
      assertCheck(
        fbRedirect1.status === 302 && fbRedirect1.headers.get('location') === fbUrl1,
        'GET /r/:code falls back cleanly to PostgreSQL (302) when Redis is unreachable',
        `status=${fbRedirect1.status}`,
      );

      const fbPatchRes = await fetch(`${base2}/links/${fbLink.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken2}`,
          'X-Request-Id': 'req-m6-fb-patch-02',
        },
        body: JSON.stringify({ long_url: fbUrl2 }),
      });
      const fbRedirect2 = await fetch(`${base2}/r/${fbLink.code}`, {
        redirect: 'manual',
      });
      assertCheck(
        fbPatchRes.status === 200 &&
          fbRedirect2.status === 302 &&
          fbRedirect2.headers.get('location') === fbUrl2,
        'PATCH /links/:id succeeds despite failed Redis invalidation and DB reflects update',
        `patch=${fbPatchRes.status}, nextRedirect=${fbRedirect2.status}`,
      );

      const fbDeleteRes = await fetch(`${base2}/links/${fbLink.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${aliceToken2}`,
          'X-Request-Id': 'req-m6-fb-del-03',
        },
      });
      const fbRedirectAfterDel = await fetch(`${base2}/r/${fbLink.code}`, { redirect: 'manual' });
      assertCheck(
        fbDeleteRes.status === 200 && fbRedirectAfterDel.status === 404,
        'DELETE /links/:id succeeds despite failed Redis invalidation and subsequent redirect returns 404',
        `delete=${fbDeleteRes.status}, after=${fbRedirectAfterDel.status}`,
      );

      await sleep(80);
      const rawS2 = server2.allOutput();
      const s2Logs = parseJsonLogLines(rawS2);
      const fallbackLogSample = s2Logs.find(
        (entry) =>
          entry.event === 'cache_redis_fallback' &&
          entry.code === fbLink.code &&
          entry.request_id === 'req-m6-fb-redir-01',
      );
      const invFailSample = s2Logs.find(
        (entry) =>
          entry.event === 'cache_invalidation_failed' &&
          entry.code === fbLink.code &&
          entry.request_id === 'req-m6-fb-patch-02',
      );
      assertCheck(
        Boolean(fallbackLogSample) && Boolean(invFailSample),
        'Broken-Redis logs emit correlated cache_redis_fallback and cache_invalidation_failed events',
      );
      if (fallbackLogSample) log(`   Sample cache_redis_fallback log: ${JSON.stringify(fallbackLogSample)}`);
      if (invFailSample) log(`   Sample cache_invalidation_failed log: ${JSON.stringify(invFailSample)}`);

      assertCheck(
        !rawS2.includes('secret-redis-pw') &&
          !rawS2.includes(fbUrl1) &&
          !rawS2.includes(fbUrl2) &&
          !rawS2.includes(aliceToken2) &&
          !rawS2.includes('alice@example.com'),
        'Broken-Redis logs redact Redis credentials and omit destination URLs, JWTs, and PII (Server #2)',
      );
    } finally {
      await stopServer(server2.process);
    }

    // SECTION C: Live Runtime Redis Outage & Auto-Recovery Drill via TCP Forwarder -> bootcamp-redis (Port 3108)
    log('\n--- SECTION C: Live Runtime Redis Outage & Recovery Drill (Port 3108) ---');
    const upstreamRedisHost = '127.0.0.1';
    const upstreamRedisPort = 6379;
    const activeSockets = new Set<net.Socket>();
    let proxyPort = 0;

    const createRedisProxy = (requestedPort = 0): Promise<net.Server> =>
      new Promise((resolve, reject) => {
        const srv = net.createServer((clientSock) => {
          const upstreamSock = net.connect(upstreamRedisPort, upstreamRedisHost);
          activeSockets.add(clientSock);
          activeSockets.add(upstreamSock);
          clientSock.pipe(upstreamSock);
          upstreamSock.pipe(clientSock);
          const cleanup = () => {
            activeSockets.delete(clientSock);
            activeSockets.delete(upstreamSock);
            clientSock.destroy();
            upstreamSock.destroy();
          };
          clientSock.on('error', cleanup);
          upstreamSock.on('error', cleanup);
          clientSock.on('close', cleanup);
          upstreamSock.on('close', cleanup);
        });
        srv.once('error', reject);
        srv.listen(requestedPort, '127.0.0.1', () => {
          const addr = srv.address();
          if (addr && typeof addr === 'object') {
            proxyPort = addr.port;
          }
          resolve(srv);
        });
      });

    let redisProxy: net.Server | null = await createRedisProxy(0);
    const server3 = await startApiServer(
      { PORT: '3108', REDIS_URL: `redis://127.0.0.1:${proxyPort}` },
      3108,
    );
    const base3 = 'http://127.0.0.1:3108';
    let liveLinkId: string | null = null;
    let aliceToken3 = '';

    try {
      aliceToken3 = await loginAlice(base3);
      const liveUrl = 'https://example.com/m6-live-container-stop';
      const liveCreateRes = await fetch(`${base3}/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken3}`,
        },
        body: JSON.stringify({ long_url: liveUrl }),
      });
      const liveLink = (await liveCreateRes.json()) as { id: string; code: string };
      liveLinkId = liveLink.id;

      const warm1 = await fetch(`${base3}/r/${liveLink.code}`, { redirect: 'manual' });
      const warm2 = await fetch(`${base3}/r/${liveLink.code}`, { redirect: 'manual' });
      assertCheck(
        warm1.status === 302 && warm2.status === 302,
        'Warm cache through Redis connection succeeds before simulating runtime Redis drop',
      );

      // Sever Redis connectivity while API process stays running
      await new Promise<void>((resolve) => {
        for (const sock of activeSockets) {
          sock.destroy();
        }
        activeSockets.clear();
        redisProxy!.close(() => resolve());
      });
      redisProxy = null;
      await sleep(250);

      const outageRedir = await fetch(`${base3}/r/${liveLink.code}`, {
        redirect: 'manual',
        headers: { 'X-Request-Id': 'req-m6-runtime-drop-01' },
      });
      assertCheck(
        outageRedir.status === 302 && outageRedir.headers.get('location') === liveUrl,
        'Live API serves HTTP 302 via PostgreSQL fallback immediately after Redis drops mid-flight',
        `status=${outageRedir.status}`,
      );

      const outageDel = await fetch(`${base3}/links/${liveLink.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${aliceToken3}` },
      });
      liveLinkId = null;
      assertCheck(outageDel.status === 200, 'DELETE succeeds while Redis is down mid-flight');

      await sleep(80);
      const s3Logs = parseJsonLogLines(server3.allOutput());
      assertCheck(
        s3Logs.some(
          (entry) =>
            entry.event === 'cache_redis_fallback' &&
            entry.code === liveLink.code &&
            entry.request_id === 'req-m6-runtime-drop-01',
        ),
        'Runtime Redis outage emits cache_redis_fallback event with matching request_id',
      );
    } finally {
      if (redisProxy) {
        for (const sock of activeSockets) {
          sock.destroy();
        }
        activeSockets.clear();
        await new Promise<void>((resolve) => redisProxy!.close(() => resolve()));
      }
      if (liveLinkId && aliceToken3) {
        await fetch(`${base3}/links/${liveLinkId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${aliceToken3}` },
        }).catch(() => {});
      }
      await stopServer(server3.process);
    }

    // SECTION D: Live Concurrent Cache-Miss Burst (Single-Flight) & Post-Burst Invalidation (Port 3110)
    log('\n--- SECTION D: Live Concurrent Cache-Miss Burst & Single-Flight Verification (Port 3110) ---');
    const server4 = await startApiServer({ PORT: '3110', REDIS_URL: 'redis://localhost:6379' }, 3110);
    const base4 = 'http://127.0.0.1:3110';
    let burstAliceToken = '';
    let burstLinkId: string | null = null;

    try {
      burstAliceToken = await loginAlice(base4);
      const initialBurstUrl = 'https://example.com/m6-burst-initial';
      const updatedBurstUrl = 'https://example.org/m6-burst-updated';

      const createBurstRes = await fetch(`${base4}/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${burstAliceToken}`,
        },
        body: JSON.stringify({ long_url: initialBurstUrl }),
      });
      const burstLink = (await createBurstRes.json()) as { id: string; code: string };
      burstLinkId = burstLink.id;
      await probeRedis.del(`redirect:v1:${burstLink.code}`);

      const burstResponses = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          fetch(`${base4}/r/${burstLink.code}`, {
            redirect: 'manual',
            headers: { 'X-Request-Id': `req-m6-sf-burst-${i + 1}` },
          }),
        ),
      );
      const allBurst302 = burstResponses.every(
        (res) => res.status === 302 && res.headers.get('location') === initialBurstUrl,
      );
      assertCheck(
        burstResponses.length === 20 && allBurst302,
        '20 concurrent cold/expired GET /r/:code requests all resolve with HTTP 302',
        `count=${burstResponses.length}`,
      );

      await sleep(100);
      const s4Logs = parseJsonLogLines(server4.allOutput());
      const missLogs = s4Logs.filter(
        (e) => e.event === 'cache_miss' && e.code === burstLink.code,
      );
      const populatedLogs = s4Logs.filter(
        (e) => e.event === 'cache_populated' && e.code === burstLink.code,
      );
      const coalescedLogs = s4Logs.filter(
        (e) => e.event === 'cache_miss_coalesced' && e.code === burstLink.code,
      );
      const hitLogs = s4Logs.filter(
        (e) => e.event === 'cache_hit' && e.code === burstLink.code,
      );
      assertCheck(
        missLogs.length >= 1 &&
          populatedLogs.length === 1 &&
          coalescedLogs.length >= 1 &&
          hitLogs.length + coalescedLogs.length >= 18,
        'Live concurrent cache-miss burst coalesces to 1 DB resolution + 1 Redis population',
        `cache_miss=${missLogs.length}, cache_populated=${populatedLogs.length}, coalesced=${coalescedLogs.length}, cache_hit=${hitLogs.length}`,
      );

      // Post-burst PATCH invalidation & DELETE check
      const burstPatchRes = await fetch(`${base4}/links/${burstLink.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${burstAliceToken}`,
        },
        body: JSON.stringify({ long_url: updatedBurstUrl }),
      });
      const afterBurstPatchRes = await fetch(`${base4}/r/${burstLink.code}`, {
        redirect: 'manual',
      });
      assertCheck(
        burstPatchRes.status === 200 &&
          afterBurstPatchRes.status === 302 &&
          afterBurstPatchRes.headers.get('location') === updatedBurstUrl,
        'PATCH invalidates cache cleanly after concurrent single-flight burst',
        `patchStatus=${burstPatchRes.status}, redirectStatus=${afterBurstPatchRes.status}`,
      );

      const burstDeleteRes = await fetch(`${base4}/links/${burstLink.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${burstAliceToken}` },
      });
      burstLinkId = null;
      const afterBurstDeleteRes = await fetch(`${base4}/r/${burstLink.code}`, {
        redirect: 'manual',
      });
      assertCheck(
        burstDeleteRes.status === 200 && afterBurstDeleteRes.status === 404,
        'DELETE invalidates cache cleanly and subsequent GET returns 404',
      );
    } finally {
      if (burstLinkId && burstAliceToken) {
        await fetch(`${base4}/links/${burstLinkId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${burstAliceToken}` },
        }).catch(() => {});
      }
      await stopServer(server4.process);
    }

    const postPing = await probeRedis.ping();
    assertCheck(
      postPing === 'PONG',
      'Dedicated bootcamp-redis remains healthy and responds to PING after verification',
      `reply=${postPing}`,
    );
  } finally {
    probeRedis.disconnect(false);
  }

  log('\n====================================================================');
  log(`SUMMARY: passed=${assertionsPassed}, failed=${failures.length}`);
  if (failures.length > 0) {
    log('Failures:');
    for (const f of failures) {
      log(` - ${f}`);
    }
  }
  log('====================================================================');
  log(`Evidence saved to: ${logFile}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
