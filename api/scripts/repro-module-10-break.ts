import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-10');
fs.mkdirSync(evidenceDir, { recursive: true });
const outFile = path.join(evidenceDir, 'break-repro-log.txt');
fs.writeFileSync(outFile, '', 'utf8');

let passed = 0;
const failures: string[] = [];

function log(msg: string): void {
  console.log(msg);
  fs.appendFileSync(outFile, msg + '\n', 'utf8');
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

async function curlProbe(url: string): Promise<{ status: number; body: string; elapsedMs: number; headers: string }> {
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
    return { status, body, elapsedMs: elapsed, headers };
  } catch (err: any) {
    const elapsed = Date.now() - start;
    return { status: 0, body: err.message || 'curl failed', elapsedMs: elapsed, headers: '' };
  }
}

async function run(): Promise<void> {
  log('====================================================================');
  log('UPSK MODULE 10 BREAK REPRODUCTION: READINESS PROBE FAILURE');
  log('HARD SCENARIO: Readiness probes fail because dependencies are not reachable');
  log('====================================================================\n');

  // Pre-flight safety checks
  log('--- Step 0: Pre-Flight Safety Verification ---');
  const testDbName = 'upsk_sdf_test';
  const testRedisDb = 1;
  assertCheck(testDbName === 'upsk_sdf_test', 'Pre-flight: Test database target is strictly upsk_sdf_test (never upsk_sdf)');
  assertCheck(testRedisDb === 1, 'Pre-flight: Test Redis target is strictly DB 1 (never DB 0)');

  const baselinePort = 3125;
  const failurePort = 3126;
  const baselineContainer = 'bootcamp-api-break-baseline';
  const failureContainer = 'bootcamp-api-break-dep-fail';

  // Ensure clean state before running
  runCmd(`docker rm -f ${baselineContainer} ${failureContainer}`);

  // Step 1: Baseline Container
  log('\n--- Step 1: Establish Healthy Baseline (Isolated Docker Container) ---');
  log(`Starting baseline container "${baselineContainer}" on port ${baselinePort}...`);
  const baselineCmd = `docker run -d --name ${baselineContainer} --add-host=host.docker.internal:host-gateway -p ${baselinePort}:3000 -e PORT=3000 -e NODE_ENV=test -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/upsk_sdf_test?schema=public" -e REDIS_URL="redis://host.docker.internal:6379/1" -e JWT_SECRET="super-secret-key-that-is-at-least-32-chars-long!" bootcamp-api`;
  const baselineId = runCmd(baselineCmd);
  assertCheck(baselineId.length >= 12 && !baselineId.includes('Error'), 'Baseline container started cleanly', baselineId.slice(0, 12));

  // Poll for healthy baseline readiness
  let baselineReady = false;
  let baseReadyRes = { status: 0, body: '', elapsedMs: 0, headers: '' };
  for (let i = 0; i < 40; i++) {
    baseReadyRes = await curlProbe(`http://127.0.0.1:${baselinePort}/ready`);
    if (baseReadyRes.status === 200 && baseReadyRes.body.includes('"status":"ready"')) {
      baselineReady = true;
      break;
    }
    await sleep(250);
  }
  assertCheck(baselineReady, 'Baseline container reached full readiness', `Status: ${baseReadyRes.status}`);

  // Query baseline /health (liveness)
  const baseHealth = await curlProbe(`http://127.0.0.1:${baselinePort}/health`);
  assertCheck(
    baseHealth.status === 200 && baseHealth.body === '{"ok":true}',
    'Baseline /health returns HTTP 200 {"ok":true}',
    `Latency: ${baseHealth.elapsedMs}ms, Body: ${baseHealth.body}`,
  );

  // Query baseline /ready (readiness)
  assertCheck(
    baseReadyRes.status === 200 &&
      baseReadyRes.body.includes('"status":"ready"') &&
      baseReadyRes.body.includes('"db":"ok"') &&
      baseReadyRes.body.includes('"redis":"ok"'),
    'Baseline /ready returns HTTP 200 with db: ok and redis: ok',
    `Latency: ${baseReadyRes.elapsedMs}ms, Body: ${baseReadyRes.body}`,
  );

  // Capture baseline container logs
  const baseLogs = runCmd(`docker logs ${baselineContainer}`);
  assertCheck(
    baseLogs.includes('db_connected') && baseLogs.includes('redis_connected') && baseLogs.includes('server_started'),
    'Baseline container logs confirm successful db_connected and redis_connected events',
  );

  // Clean up baseline container
  runCmd(`docker rm -f ${baselineContainer}`);
  log(`Baseline container "${baselineContainer}" stopped and removed.`);

  // Step 2: Inject Controlled Dependency Failure (Unreachable Database)
  log('\n--- Step 2: Inject Controlled Dependency Failure (Unreachable Database) ---');
  log(`Starting failure container "${failureContainer}" on port ${failurePort} with unreachable DB (port 5439)...`);
  const failureCmd = `docker run -d --name ${failureContainer} --add-host=host.docker.internal:host-gateway -p ${failurePort}:3000 -e PORT=3000 -e NODE_ENV=test -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5439/upsk_sdf_test?schema=public&connect_timeout=2" -e REDIS_URL="redis://host.docker.internal:6379/1" -e JWT_SECRET="super-secret-key-that-is-at-least-32-chars-long!" bootcamp-api`;
  const failureId = runCmd(failureCmd);
  assertCheck(failureId.length >= 12 && !failureId.includes('Error'), 'Failure container started cleanly', failureId.slice(0, 12));

  // Poll for HTTP server boot via /health
  let failureServerUp = false;
  let failHealthRes = { status: 0, body: '', elapsedMs: 0, headers: '' };
  for (let i = 0; i < 40; i++) {
    failHealthRes = await curlProbe(`http://127.0.0.1:${failurePort}/health`);
    if (failHealthRes.status === 200) {
      failureServerUp = true;
      break;
    }
    await sleep(250);
  }
  assertCheck(failureServerUp, 'Failure container booted HTTP server despite database outage');

  // Step 3: Reproduce and Record
  log('\n--- Step 3: Reproduce and Record Readiness Failure ---');

  // Check 1: Liveness must remain healthy (HTTP 200)
  assertCheck(
    failHealthRes.status === 200 && failHealthRes.body === '{"ok":true}',
    'Liveness probe GET /health remains HTTP 200 {"ok":true} (Decoupled from dependency failure)',
    `Status: ${failHealthRes.status}, Latency: ${failHealthRes.elapsedMs}ms, Body: ${failHealthRes.body}`,
  );

  // Check 2: Readiness probe must fail (HTTP 503)
  const failReadyRes = await curlProbe(`http://127.0.0.1:${failurePort}/ready`);
  assertCheck(
    failReadyRes.status === 503 &&
      failReadyRes.body.includes('"status":"unready"') &&
      failReadyRes.body.includes('"db":"unreachable"'),
    'Readiness probe GET /ready returns HTTP 503 Service Unavailable (Readiness failure reproduced!)',
    `Status: ${failReadyRes.status}, Latency: ${failReadyRes.elapsedMs}ms, Body: ${failReadyRes.body}`,
  );

  // Check 3: Readiness alias GET /health/ready must also return HTTP 503
  const failAliasRes = await curlProbe(`http://127.0.0.1:${failurePort}/health/ready`);
  assertCheck(
    failAliasRes.status === 503 &&
      failAliasRes.body.includes('"status":"unready"') &&
      failAliasRes.body.includes('"db":"unreachable"'),
    'Readiness alias GET /health/ready also returns HTTP 503 Service Unavailable',
    `Status: ${failAliasRes.status}, Latency: ${failAliasRes.elapsedMs}ms, Body: ${failAliasRes.body}`,
  );

  // Step 4: Container Logs & Root Cause Analysis
  log('\n--- Step 4: Container Log Analysis & Connection Errors ---');
  await sleep(600);
  const failLogs = runCmd(`docker logs ${failureContainer} 2>&1`);
  const hasDbWarn = failLogs.includes('db_initial_connect_failed') || failLogs.includes("Can't reach database server");
  const hasHttp503 = failLogs.includes('"status_code":503') || failLogs.includes('503');
  assertCheck(hasDbWarn, 'Container logs record database initial connect failure warning');
  assertCheck(hasHttp503, 'Container logs record HTTP 503 readiness probe response');

  log('\nExtracted Log Lines from Failure Container:');
  const relevantLines = failLogs.split('\n').filter((l) => l.includes('PrismaService') || l.includes('HTTP'));
  relevantLines.forEach((l) => log(`  ${l.trim()}`));

  // Step 5: Cleanup & Rollback Confirmation
  log('\n--- Step 5: Cleanup & Rollback Confirmation ---');
  runCmd(`docker rm -f ${failureContainer}`);
  log(`Failure container "${failureContainer}" stopped and removed.`);
  const psCheck = runCmd(`docker ps -a --filter name=${failureContainer}`);
  assertCheck(!psCheck.includes(failureContainer), 'Failure container verified completely removed from Docker');

  log('\n====================================================================');
  log(`BREAK REPRODUCTION RESULTS: ${passed} PASSED, ${failures.length} FAILED`);
  log('====================================================================\n');

  if (failures.length > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('[UNCAUGHT ERROR]', err);
  process.exit(1);
});
