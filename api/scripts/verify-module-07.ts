import { spawn, ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { ANALYTICS_QUEUE_NAME, ClickEventJobPayload, RECORD_CLICK_JOB_NAME } from '../src/analytics/analytics.constants';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { hashClientIp } from '../src/analytics/ip-hash.util';
import { getAnalyticsConfig } from '../src/config/validate-env';
import { PrismaClient } from '@prisma/client';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-07');
fs.mkdirSync(evidenceDir, { recursive: true });

const mainLogFile = path.join(evidenceDir, 'analytics-jobs-tests.txt');
const workerSampleFile = path.join(evidenceDir, 'worker-sample.log');
const retentionLogFile = path.join(evidenceDir, 'retention-purge-output.txt');

fs.writeFileSync(mainLogFile, '', 'utf8');
fs.writeFileSync(workerSampleFile, '', 'utf8');
fs.writeFileSync(retentionLogFile, '', 'utf8');

let assertionsPassed = 0;
const failures: string[] = [];

function log(msg: string): void {
  console.log(msg);
  fs.appendFileSync(mainLogFile, msg + '\n', 'utf8');
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

async function stopProcess(proc: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): Promise<number | null> {
  if (proc.exitCode !== null || proc.killed) {
    return proc.exitCode;
  }
  return new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore cleanup errors
      }
      resolve(proc.exitCode);
    }, 5000);

    proc.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });

    try {
      proc.kill(signal);
    } catch {
      clearTimeout(timer);
      resolve(proc.exitCode);
    }
  });
}

interface SpawnedProcess {
  process: ChildProcess;
  stdoutLines: string[];
  stderrLines: string[];
  allOutput: () => string;
}

function spawnNodeScript(
  scriptRelPath: string,
  envOverrides?: Record<string, string>,
  enableIpc = false,
): SpawnedProcess {
  const apiDir = path.resolve(__dirname, '..');
  const scriptPath = path.join(apiDir, scriptRelPath);
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const proc = spawn('node', [scriptPath], {
    cwd: apiDir,
    stdio: enableIpc ? ['pipe', 'pipe', 'pipe', 'ipc'] : 'pipe',
    shell: false,
    env: {
      ...process.env,
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

  return {
    process: proc,
    stdoutLines,
    stderrLines,
    allOutput: () => [...stdoutLines, stdoutBuf, ...stderrLines, stderrBuf].filter(Boolean).join('\n'),
  };
}

async function startApiServer(
  envOverrides?: Record<string, string>,
  port = 3120,
): Promise<SpawnedProcess> {
  const proc = spawnNodeScript('dist/main.js', {
    PORT: String(port),
    ...envOverrides,
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let i = 0; i < 35; i++) {
    await sleep(350);
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
    await stopProcess(proc.process);
    throw new Error(`API server failed to become healthy on port ${port}: ${proc.allOutput()}`);
  }

  return proc;
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

async function loginPrincipal(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as { access_token?: string };
  if (res.status !== 200 || !body.access_token) {
    throw new Error(`Login failed for ${email} with status ${res.status}`);
  }
  return body.access_token;
}

async function run(): Promise<void> {
  log('====================================================================');
  log('Module 07: Async BullMQ Analytics, Idempotency, Privacy & Retention Suite');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('====================================================================\n');

  const prisma = new PrismaClient();
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const queueRedis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    connectTimeout: 2000,
    retryStrategy: (times: number) => (times > 3 ? null : 250),
  });
  queueRedis.on('error', () => {});
  const testQueue = new Queue(ANALYTICS_QUEUE_NAME, {
    connection: queueRedis as unknown as NonNullable<ConstructorParameters<typeof Queue>[1]>['connection'],
  });
  testQueue.on('error', () => {});

  let api1: SpawnedProcess | null = null;
  let api2: SpawnedProcess | null = null;
  let api3: SpawnedProcess | null = null;
  let worker1: SpawnedProcess | null = null;
  const createdLinkIds: string[] = [];

  try {
    await queueRedis.ping();
    await testQueue.drain(true);
    assertCheck(true, 'Connected to Redis and drained analytics-clicks queue cleanly before tests');

    // SECTION 0: Privacy & Config Unit Checks
    log('\n--- SECTION 0: IP Privacy & Retention Config Checks ---');
    const prevNodeEnv = process.env.NODE_ENV;
    const prevRet = process.env.ANALYTICS_RETENTION_DAYS;
    process.env.NODE_ENV = 'production';
    process.env.ANALYTICS_RETENTION_DAYS = '0';
    const prodCfg = getAnalyticsConfig();
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevRet === undefined) delete process.env.ANALYTICS_RETENTION_DAYS;
    else process.env.ANALYTICS_RETENTION_DAYS = prevRet;

    assertCheck(
      prodCfg.retentionDays === 30 && prodCfg.zeroRetentionBlockedInProd === true,
      'Production environment rejects ANALYTICS_RETENTION_DAYS=0 and enforces 30-day default',
      `retentionDays=${prodCfg.retentionDays}`,
    );

    const hashA = hashClientIp('::ffff:203.0.113.42', 'test-secret-key-1234567890');
    const hashB = hashClientIp('203.0.113.42', 'test-secret-key-1234567890');
    assertCheck(
      hashA === hashB &&
        /^[0-9a-f]{64}$/.test(hashA) &&
        !hashA.includes('203.0.113.42'),
      'HMAC IP hashing normalizes IPv6-mapped IPv4 addresses and never exposes raw IP',
      `digestLen=${hashA.length}`,
    );

    // SECTION A: Live Redirect -> BullMQ Enqueue (with backlog), Worker Persistence & Idempotency (Port 3120)
    log('\n--- SECTION A: Async Redirect Enqueue, Backlog Independence & Worker Execution ---');
    api1 = await startApiServer({ PORT: '3120', REDIS_URL: redisUrl }, 3120);
    const base1 = 'http://127.0.0.1:3120';

    const aliceToken = await loginPrincipal(base1, 'alice@example.com', 'dev-alice-secret-01');
    const bobToken = await loginPrincipal(base1, 'bob@example.com', 'dev-bob-secret-02');

    const targetUrl = 'https://example.com/m7-analytics-secret-destination';
    const createRes = await fetch(`${base1}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ long_url: targetUrl }),
    });
    const link1 = (await createRes.json()) as { id: string; code: string };
    createdLinkIds.push(link1.id);
    assertCheck(createRes.status === 201 && Boolean(link1.id), 'Created link for Module 07 tests (201)', `code=${link1.code}`);

    // Enqueue 40 artificial backlog jobs (for missing code so worker skips them cleanly later) while worker is OFF
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        testQueue.add(
          RECORD_CLICK_JOB_NAME,
          {
            eventId: crypto.randomUUID(),
            code: 'missingBacklogCode',
            clickedAt: new Date().toISOString(),
            userAgent: 'backlog-seed',
            referrer: '',
            ipHash: hashClientIp('198.51.100.1', 'secret'),
          },
          { jobId: `backlog-${Date.now()}-${i}` },
        ),
      ),
    );

    const tStart = Date.now();
    const r1 = await fetch(`${base1}/r/${link1.code}`, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Module07-Verifier/1.0',
        Referer: 'https://ref.example.org/campaign',
        'X-Request-Id': 'req-m7-click-001',
      },
    });
    const r2 = await fetch(`${base1}/r/${link1.code}`, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Module07-Verifier/2.0',
        Referer: 'https://ref.example.org/campaign-2',
        'X-Request-Id': 'req-m7-click-002',
      },
    });
    const redirectElapsedMs = Date.now() - tStart;

    const clicksBeforeWorker = await prisma.clickEvent.count({ where: { linkId: link1.id } });
    const waitingCount = await testQueue.getWaitingCount();
    assertCheck(
      r1.status === 302 &&
        r2.status === 302 &&
        r1.headers.get('location') === targetUrl &&
        redirectElapsedMs < 1500 &&
        clicksBeforeWorker === 0 &&
        waitingCount >= 42,
      'GET /r/:code returns 302 rapidly without blocking on backlog or PostgreSQL writes',
      `elapsed=${redirectElapsedMs}ms, dbClicksBeforeWorker=${clicksBeforeWorker}, queuedWaiting=${waitingCount}`,
    );

    // Boot independent BullMQ worker process (with IPC enabled so graceful shutdown works cross-platform on Windows too)
    worker1 = spawnNodeScript('dist/worker.js', { REDIS_URL: redisUrl }, true);
    let persistedCount = 0;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      persistedCount = await prisma.clickEvent.count({ where: { linkId: link1.id } });
      const remainingWaiting = await testQueue.getWaitingCount();
      if (persistedCount === 2 && remainingWaiting === 0) {
        break;
      }
    }

    const storedClicks = await prisma.clickEvent.findMany({
      where: { linkId: link1.id },
      orderBy: { clickedAt: 'asc' },
    });
    assertCheck(
      storedClicks.length === 2 &&
        storedClicks.every(
          (c) =>
            /^[0-9a-f-]{36}$/i.test(c.idempotencyKey) &&
            /^[0-9a-f]{64}$/.test(c.ipHash) &&
            !c.ipHash.includes('127.0.0.1') &&
            !c.ipHash.includes('::1'),
        ) &&
        storedClicks[0].idempotencyKey !== storedClicks[1].idempotencyKey,
      'Standalone worker drains queue and persists 2 distinct click events with unique UUID idempotency keys & HMAC ip_hash',
      `count=${storedClicks.length}, ua0=${storedClicks[0]?.userAgent}`,
    );

    // Duplicate replay protection via PostgreSQL UNIQUE constraint (using different BullMQ jobId, same idempotency_key)
    const duplicatePayload: ClickEventJobPayload = {
      eventId: storedClicks[0].idempotencyKey,
      code: link1.code,
      linkId: link1.id,
      clickedAt: storedClicks[0].clickedAt.toISOString(),
      userAgent: storedClicks[0].userAgent,
      referrer: storedClicks[0].referrer,
      ipHash: storedClicks[0].ipHash,
      requestId: 'req-m7-dup-replay-01',
    };
    await testQueue.add(RECORD_CLICK_JOB_NAME, duplicatePayload, {
      jobId: `dup-replay-${Date.now()}`,
    });

    // Permanent invalid job test (malformed timestamp -> UnrecoverableError -> immediate permanent failure)
    const permFailEventId = crypto.randomUUID();
    const permFailJobId = `perm-fail-${Date.now()}`;
    await testQueue.add(
      RECORD_CLICK_JOB_NAME,
      {
        eventId: permFailEventId,
        code: link1.code,
        clickedAt: 'not-a-valid-date',
        userAgent: 'bad-payload',
        referrer: '',
        ipHash: 'deadbeef',
        requestId: 'req-m7-perm-fail-01',
      },
      { jobId: permFailJobId, attempts: 5, removeOnFail: 1000 },
    );

    let sawDupLog = false;
    let sawPermFailLog = false;
    let permFailLogEntry: Record<string, unknown> | undefined;
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      const wLogs = parseJsonLogLines(worker1.allOutput());
      sawDupLog = wLogs.some(
        (e) =>
          e.event === 'click_job_duplicate_ignored' &&
          e.idempotency_key === duplicatePayload.eventId,
      );
      permFailLogEntry = wLogs.find(
        (e) =>
          e.event === 'click_job_failed_permanent' &&
          e.request_id === 'req-m7-perm-fail-01' &&
          Number(e.attempt) === 1,
      );
      sawPermFailLog = Boolean(permFailLogEntry);
      if (sawDupLog && sawPermFailLog) break;
    }

    const countAfterDupReplay = await prisma.clickEvent.count({ where: { linkId: link1.id } });
    assertCheck(
      sawDupLog && countAfterDupReplay === 2,
      'Replaying duplicate click payload hits PostgreSQL unique constraint and avoids double-counting',
      `countAfterReplay=${countAfterDupReplay}`,
    );
    assertCheck(
      sawPermFailLog &&
        permFailLogEntry?.job_id === permFailJobId &&
        permFailLogEntry?.idempotency_key === permFailEventId &&
        Number(permFailLogEntry?.max_attempts) === 5 &&
        typeof permFailLogEntry?.reason === 'string' &&
        permFailLogEntry.reason.length > 0,
      'Worker handles permanent malformed payload failure cleanly in 1 attempt with full failure metadata',
    );

    const liveEnqueuedJob = await testQueue.getJob(storedClicks[0].idempotencyKey);
    const liveBackoff =
      liveEnqueuedJob?.opts?.backoff && typeof liveEnqueuedJob.opts.backoff === 'object'
        ? (liveEnqueuedJob.opts.backoff as { type?: string; delay?: number })
        : undefined;
    const retainedFailedJob = await testQueue.getJob(permFailJobId);
    assertCheck(
      Boolean(liveEnqueuedJob) &&
        liveEnqueuedJob?.opts?.attempts === 5 &&
        liveBackoff?.type === 'exponential' &&
        liveBackoff?.delay === 500 &&
        liveEnqueuedJob?.opts?.removeOnComplete === 1000 &&
        liveEnqueuedJob?.opts?.removeOnFail === 1000 &&
        Boolean(retainedFailedJob),
      'AnalyticsQueueService retains completed/failed jobs and configures 5-attempt exponential backoff (500ms)',
      `attempts=${liveEnqueuedJob?.opts?.attempts}, backoffDelay=${liveBackoff?.delay}, removeOnFail=${liveEnqueuedJob?.opts?.removeOnFail}, retainedFailed=${Boolean(retainedFailedJob)}`,
    );

    // Graceful shutdown of worker1 (uses IPC message on Windows where SIGTERM hard-terminates, falling back to SIGTERM)
    const workerExitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        void stopProcess(worker1!.process, 'SIGTERM').then(resolve);
      }, 5000);
      worker1!.process.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      if (worker1!.process.connected) {
        worker1!.process.send('shutdown');
      } else {
        worker1!.process.kill('SIGTERM');
      }
    });
    const wFinalLogs = parseJsonLogLines(worker1.allOutput());
    fs.writeFileSync(workerSampleFile, worker1.allOutput() + '\n', 'utf8');
    worker1 = null;

    assertCheck(
      workerExitCode === 0 &&
        wFinalLogs.some((e) => e.event === 'worker_stopping') &&
        wFinalLogs.some((e) => e.event === 'worker_stopped'),
      'Worker handles graceful shutdown and emits shutdown structured logs',
      `exitCode=${workerExitCode}`,
    );

    // Transient failure retry test with consistent idempotencyKey
    log('\n--- SECTION B: Transient Failure Retry & Idempotency Key Stability ---');
    const retryQueueName = `analytics-retry-test-${Date.now()}`;
    const retryRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const retryQueue = new Queue(retryQueueName, {
      connection: retryRedis as unknown as NonNullable<ConstructorParameters<typeof Queue>[1]>['connection'],
    });
    const analyticsService = new AnalyticsService(prisma as never);
    const retryEventId = crypto.randomUUID();
    const retryAttemptsObserved: Array<{ attempt: number; eventId: string }> = [];
    let transientCalls = 0;

    const retryWorker = new Worker(
      retryQueueName,
      async (job: Job<ClickEventJobPayload>) => {
        transientCalls++;
        retryAttemptsObserved.push({
          attempt: job.attemptsMade + 1,
          eventId: job.data.eventId,
        });
        if (transientCalls <= 2) {
          throw new Error('Simulated transient DB connection failure');
        }
        return analyticsService.persistClickEvent(job.data);
      },
      {
        connection: retryRedis as unknown as NonNullable<ConstructorParameters<typeof Worker>[2]>['connection'],
      },
    );

    await retryQueue.add(
      RECORD_CLICK_JOB_NAME,
      {
        eventId: retryEventId,
        code: link1.code,
        linkId: link1.id,
        clickedAt: new Date().toISOString(),
        userAgent: 'RetryTester/1.0',
        referrer: '',
        ipHash: hashClientIp('192.0.2.55', 'retry-test-salt-1234567890'),
      },
      {
        jobId: retryEventId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 60 },
      },
    );

    for (let i = 0; i < 30; i++) {
      await sleep(150);
      const retryRowCount = await prisma.clickEvent.count({
        where: { idempotencyKey: retryEventId },
      });
      if (retryRowCount === 1 && transientCalls === 3) break;
    }

    const retryRowCount = await prisma.clickEvent.count({
      where: { idempotencyKey: retryEventId },
    });
    await retryWorker.close();
    await retryQueue.obliterate({ force: true }).catch(() => {});
    await retryQueue.close();
    retryRedis.disconnect(false);

    assertCheck(
      transientCalls === 3 &&
        retryRowCount === 1 &&
        retryAttemptsObserved.every((a) => a.eventId === retryEventId),
      'Worker retries transient failures with unchanged idempotency_key and persists exactly 1 row on recovery',
      `attempts=${transientCalls}, persisted=${retryRowCount}`,
    );

    // Delete the synthetic retry row so link1 retains its exact 2 live click events for analytics API assertions
    await prisma.clickEvent.deleteMany({ where: { idempotencyKey: retryEventId } });

    // SECTION C: Owner-Scoped Analytics API, Validation, Auth/IDOR & Rate Limit
    log('\n--- SECTION C: Protected Analytics API, IDOR Isolation, Date Filtering & Rate Limit ---');
    const unauthAnalytics = await fetch(`${base1}/links/${link1.id}/analytics`);
    assertCheck(
      unauthAnalytics.status === 401,
      'Unauthenticated GET /links/:id/analytics returns HTTP 401',
      `status=${unauthAnalytics.status}`,
    );

    const nonOwnerAnalytics = await fetch(
      `${base1}/links/${link1.id}/analytics?from=2000-01-01&to=2100-01-01`,
      { headers: { Authorization: `Bearer ${bobToken}` } },
    );
    assertCheck(
      nonOwnerAnalytics.status === 404,
      'Non-owner GET /links/:id/analytics returns HTTP 404 (IDOR protection)',
      `status=${nonOwnerAnalytics.status}`,
    );

    const ownerAllRes = await fetch(
      `${base1}/links/${link1.id}/analytics?from=2000-01-01&to=2100-01-01`,
      { headers: { Authorization: `Bearer ${aliceToken}` } },
    );
    const ownerAllBody = (await ownerAllRes.json()) as {
      link_id: string;
      code: string;
      total_clicks: number;
      last_clicked_at: string | null;
    };
    assertCheck(
      ownerAllRes.status === 200 &&
        ownerAllBody.link_id === link1.id &&
        ownerAllBody.code === link1.code &&
        ownerAllBody.total_clicks === 2 &&
        typeof ownerAllBody.last_clicked_at === 'string',
      'Authenticated owner retrieves accurate analytics click count and last_clicked_at',
      `total_clicks=${ownerAllBody.total_clicks}, last_clicked_at=${ownerAllBody.last_clicked_at}`,
    );

    const pastWindowRes = await fetch(
      `${base1}/links/${link1.id}/analytics?from=2000-01-01&to=2000-01-02`,
      { headers: { Authorization: `Bearer ${aliceToken}` } },
    );
    const pastWindowBody = (await pastWindowRes.json()) as {
      total_clicks: number;
      last_clicked_at: string | null;
    };
    assertCheck(
      pastWindowRes.status === 200 &&
        pastWindowBody.total_clicks === 0 &&
        pastWindowBody.last_clicked_at === null,
      'Date range filtering excludes out-of-window clicks cleanly',
      `pastCount=${pastWindowBody.total_clicks}`,
    );

    const invalidDateRes = await fetch(
      `${base1}/links/${link1.id}/analytics?from=2030-01-01&to=2020-01-01`,
      { headers: { Authorization: `Bearer ${aliceToken}` } },
    );
    assertCheck(
      invalidDateRes.status === 400,
      'Invalid date range (from > to) returns HTTP 400',
      `status=${invalidDateRes.status}`,
    );

    // Privacy log audit across API server & worker logs
    const api1AllLogs = api1.allOutput();
    const workerAllLogs = fs.readFileSync(workerSampleFile, 'utf8');
    assertCheck(
      !api1AllLogs.includes(targetUrl) &&
        !api1AllLogs.includes(aliceToken) &&
        !api1AllLogs.includes(bobToken) &&
        !api1AllLogs.includes('127.0.0.1') &&
        !workerAllLogs.includes('127.0.0.1') &&
        !workerAllLogs.includes(targetUrl),
      'API and worker structured logs never expose raw IPs, destination URLs, or JWT secrets',
    );

    await stopProcess(api1.process);
    api1 = null;

    // Rate Limit 60 req/min on fresh isolated server (Port 3122)
    api2 = await startApiServer({ PORT: '3122', REDIS_URL: redisUrl }, 3122);
    const base2 = 'http://127.0.0.1:3122';
    const aliceToken2 = await loginPrincipal(base2, 'alice@example.com', 'dev-alice-secret-01');
    const rateStatuses: number[] = [];
    for (let i = 0; i < 65; i++) {
      const res = await fetch(
        `${base2}/links/${link1.id}/analytics?from=2000-01-01&to=2100-01-01`,
        { headers: { Authorization: `Bearer ${aliceToken2}` } },
      );
      rateStatuses.push(res.status);
    }
    const count200 = rateStatuses.filter((s) => s === 200).length;
    const count429 = rateStatuses.filter((s) => s === 429).length;
    assertCheck(
      count200 === 60 && count429 === 5 && rateStatuses[59] === 200 && rateStatuses[60] === 429,
      'GET /links/:id/analytics enforces 60 req/min rate limit returning HTTP 429 on excess',
      `allowed200=${count200}, blocked429=${count429}`,
    );

    await stopProcess(api2.process);
    api2 = null;

    // SECTION D: Broken Redis / Queue-Down Redirect Resilience (Port 3124)
    log('\n--- SECTION D: Queue-Down / Redis Outage Isolation Drill (Port 3124) ---');
    api3 = await startApiServer({ PORT: '3124', REDIS_URL: 'redis://127.0.0.1:6399' }, 3124);
    const base3 = 'http://127.0.0.1:3124';
    const outageStartMs = Date.now();
    const outageRedir = await fetch(`${base3}/r/${link1.code}`, {
      redirect: 'manual',
      headers: { 'X-Request-Id': 'req-m7-queue-down-01' },
    });
    const outageElapsedMs = Date.now() - outageStartMs;
    await sleep(60);
    const outageLogs = parseJsonLogLines(api3.allOutput());

    assertCheck(
      outageRedir.status === 302 &&
        outageRedir.headers.get('location') === targetUrl &&
        outageElapsedMs < 1500 &&
        outageLogs.some(
          (e) =>
            e.event === 'click_enqueue_fallback' &&
            e.code === link1.code &&
            e.request_id === 'req-m7-queue-down-01',
        ),
      'Redirect returns HTTP 302 rapidly via PostgreSQL even when Redis/BullMQ queue is unreachable',
      `status=${outageRedir.status}, elapsed=${outageElapsedMs}ms`,
    );

    await stopProcess(api3.process);
    api3 = null;

    // SECTION E: Data Retention Purge Verification (30-day default + controlled 0-day purge CLI)
    log('\n--- SECTION E: Retention Purge Verification ---');
    const oldClickedAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const recentClickedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const retentionLink = await prisma.link.create({
      data: {
        code: `ret${Date.now().toString(36).slice(-4)}`,
        longUrl: 'https://example.com/retention-check',
        createdBy: 'principal_a',
      },
    });
    createdLinkIds.push(retentionLink.id);

    await prisma.clickEvent.createMany({
      data: [
        {
          idempotencyKey: crypto.randomUUID(),
          linkId: retentionLink.id,
          clickedAt: oldClickedAt,
          userAgent: 'OldBot/1.0',
          referrer: '',
          ipHash: hashClientIp('203.0.113.10', 'ret-salt'),
        },
        {
          idempotencyKey: crypto.randomUUID(),
          linkId: retentionLink.id,
          clickedAt: recentClickedAt,
          userAgent: 'RecentBot/1.0',
          referrer: '',
          ipHash: hashClientIp('203.0.113.11', 'ret-salt'),
        },
      ],
    });

    const purgeDefaultProc = spawnNodeScript('dist/purge.js', {
      ANALYTICS_RETENTION_DAYS: '30',
      REDIS_URL: redisUrl,
    });
    const purgeDefaultExit = await new Promise<number | null>((resolve) =>
      purgeDefaultProc.process.once('exit', resolve),
    );
    const remainingAfter30 = await prisma.clickEvent.findMany({
      where: { linkId: retentionLink.id },
    });
    const parentLinkAfter30 = await prisma.link.findUnique({ where: { id: retentionLink.id } });

    assertCheck(
      purgeDefaultExit === 0 &&
        remainingAfter30.length === 1 &&
        remainingAfter30[0].userAgent === 'RecentBot/1.0' &&
        parentLinkAfter30 !== null,
      'Default 30-day retention purge deletes clicks >30 days old while preserving recent clicks and parent links',
      `remaining=${remainingAfter30.length}`,
    );

    const purgeZeroProc = spawnNodeScript('dist/purge.js', {
      ANALYTICS_RETENTION_DAYS: '0',
      NODE_ENV: 'development',
      REDIS_URL: redisUrl,
    });
    const purgeZeroExit = await new Promise<number | null>((resolve) =>
      purgeZeroProc.process.once('exit', resolve),
    );
    const remainingAfterZero = await prisma.clickEvent.count({
      where: { linkId: retentionLink.id },
    });
    const parentLinkAfterZero = await prisma.link.findUnique({ where: { id: retentionLink.id } });

    assertCheck(
      purgeZeroExit === 0 && remainingAfterZero === 0 && parentLinkAfterZero !== null,
      'Controlled ANALYTICS_RETENTION_DAYS=0 purge clears test click events cleanly while leaving links intact',
      `remaining=${remainingAfterZero}`,
    );

    fs.writeFileSync(
      retentionLogFile,
      [
        '=== Retention Purge (30 days) ===',
        purgeDefaultProc.allOutput(),
        `Remaining clicks for retention test link: ${remainingAfter30.length}`,
        '',
        '=== Retention Purge (0 days dev verification) ===',
        purgeZeroProc.allOutput(),
        `Remaining clicks for retention test link: ${remainingAfterZero}`,
        `Parent link preserved: ${parentLinkAfterZero !== null}`,
      ].join('\n'),
      'utf8',
    );
  } finally {
    if (worker1) await stopProcess(worker1.process).catch(() => {});
    if (api1) await stopProcess(api1.process).catch(() => {});
    if (api2) await stopProcess(api2.process).catch(() => {});
    if (api3) await stopProcess(api3.process).catch(() => {});

    if (createdLinkIds.length > 0) {
      await prisma.link.deleteMany({ where: { id: { in: createdLinkIds } } }).catch(() => {});
    }

    await testQueue.drain(true).catch(() => {});
    await testQueue.close().catch(() => {});
    retrySafeDisconnect(queueRedis);
    await prisma.$disconnect().catch(() => {});
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
  log(`Evidence saved to: ${mainLogFile}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

function retrySafeDisconnect(client: Redis): void {
  try {
    client.disconnect(false);
  } catch {
    // Ignore disconnect errors
  }
}

run().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});

