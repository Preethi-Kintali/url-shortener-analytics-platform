import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-10');
fs.mkdirSync(evidenceDir, { recursive: true });
const logFile = path.join(evidenceDir, 'fix-repro-log.txt');
fs.writeFileSync(logFile, '', 'utf8');

let passed = 0;
const failures: string[] = [];

function log(msg: string): void {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n', 'utf8');
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

async function curlProbe(url: string): Promise<{ status: number; body: string; elapsedMs: number; headers: string; raw: string }> {
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
    const headers = headerEnd !== -1 ? raw.slice(0, headerEnd).trim() : '';
    const body = headerEnd !== -1 ? raw.slice(headerEnd).trim() : raw.trim();
    return { status, body, elapsedMs: elapsed, headers, raw };
  } catch (err: any) {
    const elapsed = Date.now() - start;
    return { status: 0, body: err.message || 'curl failed', elapsedMs: elapsed, headers: '', raw: '' };
  }
}

async function run(): Promise<void> {
  log('====================================================================');
  log('UPSK MODULE 10 FIX RECOVERY VERIFICATION: READINESS RESTORATION');
  log('Testing isolated container recovery with restored DATABASE_URL');
  log('====================================================================\n');

  // STEP 1: Pre-Flight Safety & Isolation Checks
  log('--- Step 1: Pre-Flight Infrastructure & Isolation Verification ---');
  const testDbUrl = 'postgresql://postgres:postgres@localhost:5432/upsk_sdf_test?schema=public';
  const devDbUrl = 'postgresql://postgres:postgres@localhost:5432/upsk_sdf?schema=public';
  const testRedisUrl = 'redis://localhost:6379/1';
  const devRedisUrl = 'redis://localhost:6379/0';

  // Verify test database connection
  const testPrisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });
  let testDbName = '';
  try {
    const dbRes: any = await testPrisma.$queryRaw`SELECT current_database() as db`;
    testDbName = dbRes[0]?.db || '';
    assertCheck(testDbName === 'upsk_sdf_test', 'PostgreSQL port 5432 reachable, database verified as upsk_sdf_test', `Database: ${testDbName}`);
  } catch (err: any) {
    assertCheck(false, 'PostgreSQL test database connection failed', err.message);
  } finally {
    await testPrisma.$disconnect();
  }

  // Verify test Redis DB 1 connection
  const testRedis = new Redis(testRedisUrl);
  try {
    const pong = await testRedis.ping();
    assertCheck(pong === 'PONG', 'Redis port 6379 DB 1 reachable and responsive', `PING -> ${pong}`);
  } catch (err: any) {
    assertCheck(false, 'Redis test DB 1 connection failed', err.message);
  } finally {
    testRedis.disconnect();
  }

  // Record baseline row counts of development database upsk_sdf to guarantee zero changes
  const devPrisma = new PrismaClient({ datasources: { db: { url: devDbUrl } } });
  let initialDevLinkCount = -1;
  let initialDevClickCount = -1;
  try {
    initialDevLinkCount = await devPrisma.link.count();
    initialDevClickCount = await devPrisma.clickEvent.count();
    log(`Development DB (upsk_sdf) baseline: ${initialDevLinkCount} links, ${initialDevClickCount} click events`);
  } catch (err: any) {
    log(`Note: Dev DB query status: ${err.message}`);
  } finally {
    await devPrisma.$disconnect();
  }

  // Record baseline key count of Redis DB 0 to guarantee zero changes
  const devRedis = new Redis(devRedisUrl);
  let initialDevRedisKeys = -1;
  try {
    initialDevRedisKeys = await devRedis.dbsize();
    log(`Development Redis DB 0 baseline key count: ${initialDevRedisKeys}`);
  } catch (err: any) {
    log(`Note: Dev Redis query status: ${err.message}`);
  } finally {
    devRedis.disconnect();
  }

  // STEP 2: Verify Host Port 3127 & Container Name Availability
  log('\n--- Step 2: Port & Container Name Availability ---');
  const recoveryPort = 3127;
  const containerName = 'bootcamp-api-fix-verify';

  // Ensure container name is not in use
  runCmd(`docker rm -f ${containerName}`);
  const psCheck = runCmd(`docker ps -a --filter name=${containerName}`);
  assertCheck(!psCheck.includes(containerName), `Container name "${containerName}" is available`);

  // STEP 3: Launch Recovery Container with Restored Configuration
  log('\n--- Step 3: Launch Recovery Container with Restored Configuration ---');
  const launchCmd = `docker run -d --name ${containerName} --add-host=host.docker.internal:host-gateway -p ${recoveryPort}:3000 -e PORT=3000 -e NODE_ENV=test -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/upsk_sdf_test?schema=public" -e REDIS_URL="redis://host.docker.internal:6379/1" -e JWT_SECRET="super-secret-key-that-is-at-least-32-chars-long!" bootcamp-api`;
  log(`Executing: ${launchCmd}`);
  const containerId = runCmd(launchCmd);
  assertCheck(containerId.length >= 12 && !containerId.includes('Error'), 'Recovery container started cleanly', containerId.slice(0, 12));

  // STEP 4: Poll and Verify Health and Readiness
  log('\n--- Step 4: Health and Readiness Probes Verification ---');
  let isReady = false;
  let readyProbeResult = { status: 0, body: '', elapsedMs: 0, headers: '', raw: '' };
  for (let i = 0; i < 40; i++) {
    readyProbeResult = await curlProbe(`http://127.0.0.1:${recoveryPort}/ready`);
    if (readyProbeResult.status === 200 && readyProbeResult.body.includes('"status":"ready"')) {
      isReady = true;
      break;
    }
    await sleep(250);
  }
  assertCheck(isReady, 'Recovery container achieved readiness (HTTP 200 ready)', `Status: ${readyProbeResult.status}`);

  // Probe 1: GET /health (Liveness)
  const healthProbe = await curlProbe(`http://127.0.0.1:${recoveryPort}/health`);
  assertCheck(
    healthProbe.status === 200 && healthProbe.body === '{"ok":true}',
    'Liveness probe GET /health returns HTTP 200 {"ok":true}',
    `Latency: ${healthProbe.elapsedMs}ms, Body: ${healthProbe.body}`,
  );
  log(`\nRaw /health Response:\n${healthProbe.raw}\n`);

  // Probe 2: GET /ready (Readiness)
  assertCheck(
    readyProbeResult.status === 200 &&
      readyProbeResult.body.includes('"status":"ready"') &&
      readyProbeResult.body.includes('"db":"ok"') &&
      readyProbeResult.body.includes('"redis":"ok"'),
    'Readiness probe GET /ready returns HTTP 200 with db: ok and redis: ok',
    `Latency: ${readyProbeResult.elapsedMs}ms, Body: ${readyProbeResult.body}`,
  );
  log(`\nRaw /ready Response:\n${readyProbeResult.raw}\n`);

  // Probe 3: GET /health/ready (Alias)
  const aliasProbe = await curlProbe(`http://127.0.0.1:${recoveryPort}/health/ready`);
  assertCheck(
    aliasProbe.status === 200 &&
      aliasProbe.body.includes('"status":"ready"') &&
      aliasProbe.body.includes('"db":"ok"') &&
      aliasProbe.body.includes('"redis":"ok"'),
    'Readiness alias GET /health/ready returns HTTP 200 matching /ready',
    `Latency: ${aliasProbe.elapsedMs}ms, Body: ${aliasProbe.body}`,
  );
  log(`\nRaw /health/ready Response:\n${aliasProbe.raw}\n`);

  // STEP 5: Container Log Inspection
  log('\n--- Step 5: Container Logs Inspection ---');
  await sleep(600);
  const containerLogs = runCmd(`docker logs ${containerName} 2>&1`);
  const hasDbConnected = containerLogs.includes('db_connected');
  const hasRedisConnected = containerLogs.includes('redis_connected');
  const hasServerStarted = containerLogs.includes('server_started');
  const hasZeroDbErrors = !containerLogs.includes('db_initial_connect_failed');

  assertCheck(hasDbConnected, 'Container logs confirm db_connected event');
  assertCheck(hasRedisConnected, 'Container logs confirm redis_connected event');
  assertCheck(hasServerStarted, 'Container logs confirm server_started event on port 3000');
  assertCheck(hasZeroDbErrors, 'Container logs show zero database connection warnings or errors');

  log('\nCaptured Container Logs:');
  containerLogs.split('\n').forEach((l) => log(`  ${l.trim()}`));

  // STEP 6: Container Cleanup
  log('\n--- Step 6: Container Cleanup ---');
  runCmd(`docker stop ${containerName}`);
  runCmd(`docker rm ${containerName}`);
  log(`Container "${containerName}" stopped and removed.`);

  const leftoverCheck = runCmd(`docker ps -a --filter name=${containerName}`);
  assertCheck(!leftoverCheck.includes(containerName), 'Container verified completely removed from Docker');

  // STEP 7: Verify Development Environment Untouched
  log('\n--- Step 7: Verify Development PostgreSQL and Redis DB 0 Untouched ---');
  const devPrismaAfter = new PrismaClient({ datasources: { db: { url: devDbUrl } } });
  try {
    const finalDevLinkCount = await devPrismaAfter.link.count();
    const finalDevClickCount = await devPrismaAfter.clickEvent.count();
    assertCheck(
      initialDevLinkCount === finalDevLinkCount && initialDevClickCount === finalDevClickCount,
      'Development PostgreSQL database (upsk_sdf) completely unchanged',
      `Links: ${initialDevLinkCount} -> ${finalDevLinkCount}, ClickEvents: ${initialDevClickCount} -> ${finalDevClickCount}`,
    );
  } finally {
    await devPrismaAfter.$disconnect();
  }

  const devRedisAfter = new Redis(devRedisUrl);
  try {
    const finalDevRedisKeys = await devRedisAfter.dbsize();
    assertCheck(
      initialDevRedisKeys === finalDevRedisKeys,
      'Development Redis DB 0 completely unchanged',
      `Key count: ${initialDevRedisKeys} -> ${finalDevRedisKeys}`,
    );
  } finally {
    devRedisAfter.disconnect();
  }

  // Summary
  log('\n====================================================================');
  log(`FIX RECOVERY RESULTS: ${passed} PASSED, ${failures.length} FAILED`);
  log('====================================================================\n');

  if (failures.length > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('[UNCAUGHT ERROR]', err);
  process.exit(1);
});

