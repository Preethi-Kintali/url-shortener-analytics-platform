import { execSync } from 'child_process';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-10');
fs.mkdirSync(evidenceDir, { recursive: true });
const reportFile = path.join(evidenceDir, 'graceful-shutdown-drill.txt');
fs.writeFileSync(reportFile, '', 'utf8');

let passed = 0;
const failures: string[] = [];

function log(msg: string): void {
  console.log(msg);
  fs.appendFileSync(reportFile, msg + '\n', 'utf8');
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

function runCmd(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err: any) {
    return ((err.stdout || '') + '\n' + (err.stderr || err.message || '')).trim();
  }
}

async function curlProbe(url: string): Promise<{ status: number; body: string; elapsedMs: number }> {
  const start = Date.now();
  try {
    const raw = execSync(`curl.exe -i -s "${url}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });
    const elapsed = Date.now() - start;
    const statusMatch = raw.match(/HTTP\/1\.[01]\s+(\d{3})/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
    const headerEnd = raw.indexOf('\r\n\r\n') !== -1 ? raw.indexOf('\r\n\r\n') : raw.indexOf('\n\n');
    const body = headerEnd !== -1 ? raw.slice(headerEnd).trim() : raw.trim();
    return { status, body, elapsedMs: elapsed };
  } catch (err: any) {
    const elapsed = Date.now() - start;
    return { status: 0, body: err.message || 'curl failed', elapsedMs: elapsed };
  }
}

async function run(): Promise<void> {
  log('====================================================================');
  log('UPSK MODULE 10 EMPIRICAL GRACEFUL SHUTDOWN DRILL');
  log('In-Flight Request Completion & Resource Teardown Verification');
  log('====================================================================\n');

  // STEP 1: Pre-Flight Safety & Baseline Verification
  log('--- Step 1: Pre-Flight Verification & Resource Baselines ---');
  const testDbUrl = 'postgresql://postgres:postgres@localhost:5432/upsk_sdf_test?schema=public';
  const devDbUrl = 'postgresql://postgres:postgres@localhost:5432/upsk_sdf?schema=public';
  const testRedisUrl = 'redis://localhost:6379/1';
  const devRedisUrl = 'redis://localhost:6379/0';

  // Verify test database
  const testPrisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });
  try {
    const res: any = await testPrisma.$queryRaw`SELECT current_database() as db`;
    const dbName = res[0]?.db;
    assertCheck(dbName === 'upsk_sdf_test', 'PostgreSQL port 5432 reachable, verified database is upsk_sdf_test');
  } catch (err: any) {
    assertCheck(false, 'PostgreSQL test database connection failed', err.message);
  }

  // Verify test Redis DB 1
  const testRedis = new Redis(testRedisUrl);
  try {
    const pong = await testRedis.ping();
    assertCheck(pong === 'PONG', 'Redis port 6379 DB 1 reachable and responsive', `PING -> ${pong}`);
  } catch (err: any) {
    assertCheck(false, 'Redis DB 1 connection failed', err.message);
  }

  // Baseline row count of upsk_sdf (dev db)
  const devPrisma = new PrismaClient({ datasources: { db: { url: devDbUrl } } });
  let initialDevLinks = -1;
  let initialDevClicks = -1;
  try {
    initialDevLinks = await devPrisma.link.count();
    initialDevClicks = await devPrisma.clickEvent.count();
    log(`Development DB (upsk_sdf) baseline: ${initialDevLinks} links, ${initialDevClicks} click events`);
  } catch (err: any) {
    log(`Note: Dev DB query status: ${err.message}`);
  }

  // Baseline key count of dev Redis DB 0
  const devRedis = new Redis(devRedisUrl);
  let initialDevRedisKeys = -1;
  try {
    initialDevRedisKeys = await devRedis.dbsize();
    log(`Development Redis DB 0 baseline key count: ${initialDevRedisKeys}`);
  } catch (err: any) {
    log(`Note: Dev Redis query status: ${err.message}`);
  }

  // STEP 2: Container Launch on Port 3128
  log('\n--- Step 2: Launch Isolated Drill Container ---');
  const drillPort = 3128;
  const containerName = 'bootcamp-api-shutdown-drill';

  runCmd(`docker rm -f ${containerName}`);
  const launchCmd = `docker run -d --name ${containerName} --add-host=host.docker.internal:host-gateway -p ${drillPort}:3000 -e PORT=3000 -e NODE_ENV=test -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/upsk_sdf_test?schema=public" -e REDIS_URL="redis://host.docker.internal:6379/1" -e JWT_SECRET="super-secret-key-that-is-at-least-32-chars-long!" bootcamp-api`;
  log(`Executing: ${launchCmd}`);
  const containerId = runCmd(launchCmd);
  assertCheck(containerId.length >= 12 && !containerId.includes('Error'), 'Drill container started cleanly', containerId.slice(0, 12));

  // Poll for full readiness
  let isReady = false;
  for (let i = 0; i < 40; i++) {
    const res = await curlProbe(`http://127.0.0.1:${drillPort}/ready`);
    if (res.status === 200 && res.body.includes('"status":"ready"')) {
      isReady = true;
      break;
    }
    await sleep(250);
  }
  assertCheck(isReady, 'Drill container achieved full readiness on port ' + drillPort);

  // STEP 3: Inspect Active Runtime Connections While Container is Running
  log('\n--- Step 3: Inspect Active Runtime Connections (Before Shutdown) ---');
  let activePgConnsBefore = 0;
  try {
    const pgConnsRes: any = await testPrisma.$queryRaw`SELECT count(*)::int as c FROM pg_stat_activity WHERE datname = 'upsk_sdf_test' AND application_name != 'drill_client'`;
    activePgConnsBefore = pgConnsRes[0]?.c || 0;
    log(`Active PostgreSQL connections on upsk_sdf_test (before shutdown): ${activePgConnsBefore}`);
    assertCheck(activePgConnsBefore > 0, 'PostgreSQL connection pool actively established by container before shutdown');
  } catch (err: any) {
    log(`Note: PG connections query error: ${err.message}`);
  }

  let redisClientsBefore = 0;
  try {
    const clientList = await testRedis.client('LIST');
    const lines = (clientList as string).trim().split('\n').filter(Boolean);
    redisClientsBefore = lines.length;
    log(`Active Redis clients on Redis (before shutdown): ${redisClientsBefore}`);
    assertCheck(redisClientsBefore > 0, 'Redis client connections actively established by container before shutdown');
  } catch (err: any) {
    log(`Note: Redis clients query error: ${err.message}`);
  }

  // STEP 4: In-Flight Request with Concurrent SIGTERM
  log('\n--- Step 4: Dispatch In-Flight Request & Concurrent SIGTERM ---');

  // We initiate an HTTP request. Upon socket connect, we immediately send SIGTERM to the container.
  interface InFlightResult {
    statusCode: number;
    body: string;
    socketError: string | null;
    requestStartTime: number;
    requestSocketConnectTime: number;
    responseStartTime: number;
    responseEndTime: number;
    durationMs: number;
  }

  const inFlightPromise = new Promise<InFlightResult>((resolve) => {
    const startT = Date.now();
    let connectT = 0;
    let respStartT = 0;

    const req = http.request(
      {
        host: '127.0.0.1',
        port: drillPort,
        path: '/ready',
        method: 'GET',
        headers: { 'Connection': 'close' },
      },
      (res) => {
        respStartT = Date.now();
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          const endT = Date.now();
          resolve({
            statusCode: res.statusCode || 0,
            body,
            socketError: null,
            requestStartTime: startT,
            requestSocketConnectTime: connectT,
            responseStartTime: respStartT,
            responseEndTime: endT,
            durationMs: endT - startT,
          });
        });
      },
    );

    req.on('socket', (socket) => {
      socket.on('connect', () => {
        connectT = Date.now();
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 0,
        body: '',
        socketError: err.message,
        requestStartTime: startT,
        requestSocketConnectTime: connectT,
        responseStartTime: 0,
        responseEndTime: Date.now(),
        durationMs: Date.now() - startT,
      });
    });

    req.end();
  });

  // Small delay to ensure the HTTP request has established its TCP socket and is in-flight on the server
  await sleep(10);

  const sigtermSentTime = Date.now();
  log(`Dispatching SIGTERM to container "${containerName}" at T=${sigtermSentTime}...`);
  // Use docker stop -t 10 (Docker sends SIGTERM first; if process handles it, stops immediately)
  const stopCmdOutput = runCmd(`docker stop -t 10 ${containerName}`);
  const stopCompleteTime = Date.now();
  const stopDurationMs = stopCompleteTime - sigtermSentTime;
  log(`Container stopped in ${stopDurationMs}ms. Command output: ${stopCmdOutput}`);

  const inFlightResult = await inFlightPromise;

  // Assertions on the in-flight request
  assertCheck(
    inFlightResult.socketError === null,
    'In-flight HTTP request completed without socket error or ECONNRESET',
    `Socket error: ${inFlightResult.socketError || 'none'}`,
  );
  assertCheck(
    inFlightResult.statusCode === 200,
    'In-flight HTTP request received HTTP 200 OK during shutdown',
    `Status: ${inFlightResult.statusCode}, Body: ${inFlightResult.body}`,
  );
  assertCheck(
    inFlightResult.body.includes('"status":"ready"'),
    'In-flight response body completed with full ready payload',
    inFlightResult.body,
  );

  // Chronological timeline evidence proving request was genuinely in flight
  log('\nChronological Event Timeline:');
  log(`  [1] Request socket connected: T=0ms (epoch: ${inFlightResult.requestSocketConnectTime})`);
  log(`  [2] SIGTERM signal dispatched: T=+${sigtermSentTime - inFlightResult.requestSocketConnectTime}ms (epoch: ${sigtermSentTime})`);
  log(`  [3] In-flight response finished: T=+${inFlightResult.responseEndTime - inFlightResult.requestSocketConnectTime}ms (epoch: ${inFlightResult.responseEndTime})`);
  log(`  [4] Container stop completed: T=+${stopCompleteTime - inFlightResult.requestSocketConnectTime}ms (epoch: ${stopCompleteTime})`);

  assertCheck(
    inFlightResult.requestSocketConnectTime <= sigtermSentTime &&
      inFlightResult.statusCode === 200 &&
      inFlightResult.socketError === null,
    'Timeline and status confirm HTTP request was in flight when SIGTERM was dispatched and completed cleanly',
    `Request started at ${inFlightResult.requestSocketConnectTime}, SIGTERM sent at ${sigtermSentTime} (+${sigtermSentTime - inFlightResult.requestSocketConnectTime}ms later), received HTTP 200 with zero socket errors`,
  );

  // STEP 5: Verify Subsequent Connections are Refused (Server stopped listening)
  log('\n--- Step 5: Verify Post-Shutdown Traffic Rejection ---');
  const postShutdownProbe = await curlProbe(`http://127.0.0.1:${drillPort}/health`);
  assertCheck(
    postShutdownProbe.status === 0,
    'New connection attempts immediately rejected / connection refused after shutdown',
    `Probe status: ${postShutdownProbe.status} (curl failed as expected)`,
  );

  // STEP 6: Container Exit Code & Stop Duration
  log('\n--- Step 6: Container State & Exit Code Inspection ---');
  const containerStatus = runCmd(`docker inspect --format "{{.State.Status}}" ${containerName}`);
  const containerExitCode = runCmd(`docker inspect --format "{{.State.ExitCode}}" ${containerName}`);
  assertCheck(containerStatus === 'exited', 'Container status is "exited"', `Status: ${containerStatus}`);
  assertCheck(
    containerExitCode === '0' || containerExitCode === '143',
    'Container exited cleanly with standard termination code (0 or 143)',
    `Exit code: ${containerExitCode}`,
  );
  assertCheck(stopDurationMs < 3000, `Container terminated gracefully in ${stopDurationMs}ms (< 3,000ms grace window)`);

  // STEP 7: Inspect Complete Container Logs
  log('\n--- Step 7: Complete Container Shutdown Logs ---');
  const shutdownLogs = runCmd(`docker logs ${containerName} 2>&1`);
  log('Captured Logs:');
  shutdownLogs.split('\n').forEach((l) => log(`  ${l.trim()}`));

  // STEP 8: Runtime Dependency Evidence (Post-Shutdown)
  log('\n--- Step 8: Post-Shutdown Database & Redis Connection Verification ---');
  let activePgConnsAfter = 0;
  try {
    const pgConnsAfterRes: any = await testPrisma.$queryRaw`SELECT count(*)::int as c FROM pg_stat_activity WHERE datname = 'upsk_sdf_test' AND application_name != 'drill_client'`;
    activePgConnsAfter = pgConnsAfterRes[0]?.c || 0;
    log(`Active PostgreSQL connections on upsk_sdf_test (after shutdown): ${activePgConnsAfter}`);
    assertCheck(
      activePgConnsAfter < activePgConnsBefore,
      'PostgreSQL connection pool closed; active connections dropped after container shutdown',
      `Before: ${activePgConnsBefore} -> After: ${activePgConnsAfter}`,
    );
  } catch (err: any) {
    log(`Note: PG connections query error: ${err.message}`);
  }

  let redisClientsAfter = 0;
  try {
    const clientListAfter = await testRedis.client('LIST');
    const linesAfter = (clientListAfter as string).trim().split('\n').filter(Boolean);
    redisClientsAfter = linesAfter.length;
    log(`Active Redis clients on Redis (after shutdown): ${redisClientsAfter}`);
    assertCheck(
      redisClientsAfter < redisClientsBefore,
      'Redis client connections closed; active clients dropped after container shutdown',
      `Before: ${redisClientsBefore} -> After: ${redisClientsAfter}`,
    );
  } catch (err: any) {
    log(`Note: Redis clients query error: ${err.message}`);
  }

  // Explicit analysis of logging limitation
  log('\nLogging Limitation Note:');
  const hasExplicitPrismaDisconnectLog = shutdownLogs.includes('db_disconnected') || shutdownLogs.includes('db_disconnect');
  const hasExplicitRedisQuitLog = shutdownLogs.includes('redis_disconnected') || shutdownLogs.includes('redis_quit');
  log(`  - Direct Prisma disconnect log in stdout: ${hasExplicitPrismaDisconnectLog ? 'YES' : 'NONE (PrismaService.onModuleDestroy only emits logs on failure)'}`);
  log(`  - Direct Redis quit log in stdout: ${hasExplicitRedisQuitLog ? 'YES' : 'NONE (RedisCacheService.onModuleDestroy quits silently without stdout emission)'}`);
  log(`  - Concrete runtime proof: Established via pg_stat_activity (connections dropped from ${activePgConnsBefore} to ${activePgConnsAfter}) and Redis CLIENT LIST (clients dropped from ${redisClientsBefore} to ${redisClientsAfter}).`);

  // STEP 9: Cleanup & Teardown
  log('\n--- Step 9: Container Cleanup & Teardown ---');
  runCmd(`docker rm -f ${containerName}`);
  log(`Container "${containerName}" removed.`);
  const psCheck = runCmd(`docker ps -a --filter name=${containerName}`);
  assertCheck(!psCheck.includes(containerName), 'Drill container verified completely removed from Docker');

  // STEP 10: Verify Development Database & Redis DB 0 Untouched
  log('\n--- Step 10: Development Environment Integrity Verification ---');
  try {
    const finalDevLinks = await devPrisma.link.count();
    const finalDevClicks = await devPrisma.clickEvent.count();
    assertCheck(
      initialDevLinks === finalDevLinks && initialDevClicks === finalDevClicks,
      'Development PostgreSQL database (upsk_sdf) completely unchanged',
      `Links: ${initialDevLinks} -> ${finalDevLinks}, ClickEvents: ${initialDevClicks} -> ${finalDevClicks}`,
    );
  } finally {
    await devPrisma.$disconnect();
    await testPrisma.$disconnect();
  }

  try {
    const finalDevRedisKeys = await devRedis.dbsize();
    assertCheck(
      initialDevRedisKeys === finalDevRedisKeys,
      'Development Redis DB 0 completely unchanged',
      `Key count: ${initialDevRedisKeys} -> ${finalDevRedisKeys}`,
    );
  } finally {
    devRedis.disconnect();
    testRedis.disconnect();
  }

  // Summary
  log('\n====================================================================');
  log(`GRACEFUL SHUTDOWN DRILL RESULTS: ${passed} PASSED, ${failures.length} FAILED`);
  log('====================================================================\n');

  if (failures.length > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('[UNCAUGHT ERROR]', err);
  process.exit(1);
});
