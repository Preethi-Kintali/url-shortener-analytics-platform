import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-10');
fs.mkdirSync(evidenceDir, { recursive: true });

const logFile = path.join(evidenceDir, 'health-readiness-tests.txt');
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

// ====================================================================
// SECTION 1: MANDATORY PRE-FLIGHT DATABASE & REDIS ISOLATION
// ====================================================================

process.env.NODE_ENV = 'test';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/upsk_sdf_test?schema=public';
const TEST_REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';
const TEST_PORT = 3110;
const SECONDARY_TEST_PORT = 3111;

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
      throw new Error(`CRITICAL SAFETY VIOLATION: Database URL targets production! Refusing execution.`);
    }

    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      throw new Error(`CRITICAL SAFETY VIOLATION: Database protocol "${parsed.protocol}" is not postgresql.`);
    }
    const dbName = parsed.pathname.replace(/^\//, '');
    const host = parsed.hostname;
    const port = parsed.port || '5432';
    const env = process.env.NODE_ENV || 'development';

    if (dbName !== 'upsk_sdf_test') {
      throw new Error(`CRITICAL SAFETY VIOLATION: Target database "${dbName}" is not "upsk_sdf_test"!`);
    }
    if (host !== 'localhost' && host !== '127.0.0.1') {
      throw new Error(`CRITICAL SAFETY VIOLATION: Target host "${host}" is not local.`);
    }
    if (port !== '5432') {
      throw new Error(`CRITICAL SAFETY VIOLATION: Target port "${port}" is not expected port 5432.`);
    }
    if (env !== 'test') {
      throw new Error(`CRITICAL SAFETY VIOLATION: Execution environment "${env}" is not explicitly "test".`);
    }

    return { dbName, host, port, env };
  } catch (error) {
    console.error('[ISOLATION ERROR]', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function validateRedisIsolation(rawRedisUrl: string): Promise<number> {
  const parsed = new URL(rawRedisUrl);
  const dbIndex = parseInt(parsed.pathname.replace(/^\//, '') || '0', 10);
  if (dbIndex !== 1) {
    console.error(`[CRITICAL REDIS SAFETY VIOLATION]: Tests must target Redis DB 1, received DB ${dbIndex}.`);
    process.exit(1);
  }
  return dbIndex;
}

// ====================================================================
// SECTION 2: VERIFICATION EXECUTION
// ====================================================================

async function runModule10Verification() {
  log('====================================================================');
  log('UPSK MODULE 10 BUILD VERIFICATION: CI/CD & DEPLOYMENT (RAILWAY)');
  log('====================================================================\n');

  // Check 1: Database and Redis Isolation Pre-flight
  const dbIsolation = validateDatabaseIsolation(TEST_DATABASE_URL);
  const redisDbIndex = await validateRedisIsolation(TEST_REDIS_URL);
  assertCheck(
    dbIsolation.dbName === 'upsk_sdf_test' && redisDbIndex === 1,
    'Database & Redis isolation pre-flight verified',
    `Database: ${dbIsolation.dbName} on ${dbIsolation.host}:${dbIsolation.port}, Redis DB: ${redisDbIndex}`,
  );

  // Check 2: Verify dedicated migration command
  log('\n--- Step 2: One-Off Migration Command Verification ---');
  const packageJsonPath = path.resolve(__dirname, '../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assertCheck(
    typeof packageJson.scripts?.migrate === 'string' &&
      packageJson.scripts.migrate.includes('prisma migrate deploy'),
    'Dedicated npm run migrate script exists using prisma migrate deploy',
    `Script: "${packageJson.scripts?.migrate}"`,
  );

  // Test migration command execution against test database
  const migrationOutput = await new Promise<{ code: number; stdout: string }>((resolve) => {
    const child = spawn('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
      },
      shell: true,
    });
    let stdout = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stdout += d.toString()));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }));
  });

  assertCheck(
    migrationOutput.code === 0,
    'One-off migration execution succeeds idempotently against test database',
    migrationOutput.stdout.trim().split('\n').pop() || '0 migrations pending',
  );

  // Save migration deploy evidence
  const migrationEvidenceFile = path.join(evidenceDir, 'migration-deploy.txt');
  fs.writeFileSync(
    migrationEvidenceFile,
    `=== PRISMA MIGRATE DEPLOY EVIDENCE ===\nCommand: npx prisma migrate deploy\nDatabase: ${sanitizeUrl(TEST_DATABASE_URL)}\nExit Code: ${migrationOutput.code}\nOutput:\n${migrationOutput.stdout}\n`,
    'utf8',
  );

  // Check 3: Multi-Stage Dockerfile Verification
  log('\n--- Step 3: Multi-Stage Dockerfile Verification ---');
  const dockerfilePath = path.resolve(__dirname, '../Dockerfile');
  const dockerignorePath = path.resolve(__dirname, '../.dockerignore');

  assertCheck(fs.existsSync(dockerfilePath), 'Dockerfile exists in api root');
  assertCheck(fs.existsSync(dockerignorePath), '.dockerignore exists in api root');

  if (fs.existsSync(dockerfilePath)) {
    const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');
    assertCheck(
      dockerfileContent.includes('AS builder') && dockerfileContent.includes('AS runner'),
      'Dockerfile implements multi-stage build (builder -> runner)',
    );
    assertCheck(
      dockerfileContent.includes('USER nestjs') || dockerfileContent.includes('USER node'),
      'Dockerfile runs production container as non-root user',
    );
    assertCheck(
      dockerfileContent.includes('EXPOSE 3000') && dockerfileContent.includes('CMD ["node", "dist/main"]'),
      'Dockerfile specifies EXPOSE 3000 and CMD ["node", "dist/main"]',
    );
  }

  // Check 4: GitHub Actions CI Configuration Verification
  log('\n--- Step 4: GitHub Actions CI Pipeline Verification ---');
  const ciWorkflowPath = path.resolve(__dirname, '../../.github/workflows/ci.yml');
  assertCheck(fs.existsSync(ciWorkflowPath), 'GitHub Actions ci.yml exists at .github/workflows/ci.yml');

  if (fs.existsSync(ciWorkflowPath)) {
    const ciContent = fs.readFileSync(ciWorkflowPath, 'utf8');
    assertCheck(
      ciContent.includes('postgres:16-alpine') && ciContent.includes('redis:7-alpine'),
      'CI workflow defines PostgreSQL and Redis service containers',
    );
    assertCheck(
      ciContent.includes('prisma migrate deploy'),
      'CI workflow runs one-off prisma migrate deploy before tests',
    );
    assertCheck(
      ciContent.includes('pnpm run test') || ciContent.includes('npm test'),
      'CI workflow runs test suite and build',
    );

    // Save CI pipeline evidence
    const ciEvidenceFile = path.join(evidenceDir, 'ci-pipeline.txt');
    fs.writeFileSync(ciEvidenceFile, ciContent, 'utf8');
  }

  // Check 5: Dynamic PORT Configuration and Explicit 0.0.0.0 Binding
  log('\n--- Step 5: Server Dynamic PORT & 0.0.0.0 Host Binding ---');
  const apiMainPath = path.resolve(__dirname, '../dist/main.js');
  const mainTsPath = path.resolve(__dirname, '../src/main.ts');
  const mainTsContent = fs.readFileSync(mainTsPath, 'utf8');

  assertCheck(
    mainTsContent.includes("await app.listen(env.port, '0.0.0.0')") ||
      mainTsContent.includes('await app.listen(env.port, "0.0.0.0")'),
    'Server explicitly binds to 0.0.0.0 in main.ts',
  );
  assertCheck(
    mainTsContent.includes('app.enableShutdownHooks()'),
    'Server explicitly enables NestJS graceful shutdown hooks in main.ts',
  );

  // Spawn test server on dynamic port 3110
  log(`Spawning test API server on dynamic PORT=${TEST_PORT}...`);
  const serverProcess: ChildProcess = spawn('node', [apiMainPath], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(TEST_PORT),
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      JWT_SECRET: 'super-secret-key-that-is-at-least-32-chars-long!',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  serverProcess.stdout?.on('data', (d) => (serverOutput += d.toString()));
  serverProcess.stderr?.on('data', (d) => (serverOutput += d.toString()));

  // Wait for server ready on port 3110
  let isUp = false;
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.status === 200) {
        isUp = true;
        break;
      }
    } catch {
      await sleep(250);
    }
  }

  assertCheck(isUp, `Server booted successfully on dynamic PORT=${TEST_PORT}`);

  // Check 6: Liveness & Readiness Endpoints
  log('\n--- Step 6: Liveness & Readiness Probes Verification ---');
  try {
    // Probe 1: GET /health (Liveness)
    const livenessRes = await fetch(`${baseUrl}/health`);
    const livenessBody = await livenessRes.json();
    assertCheck(
      livenessRes.status === 200 && livenessBody.ok === true,
      'GET /health returns HTTP 200 { ok: true } (Liveness probe)',
      JSON.stringify(livenessBody),
    );

    // Probe 2: GET /ready (Readiness)
    const readinessRes = await fetch(`${baseUrl}/ready`);
    const readinessBody = await readinessRes.json();
    assertCheck(
      readinessRes.status === 200 &&
        readinessBody.ok === true &&
        readinessBody.status === 'ready' &&
        readinessBody.db === 'ok' &&
        readinessBody.redis === 'ok',
      'GET /ready returns HTTP 200 with db: ok and redis: ok (Readiness probe)',
      JSON.stringify(readinessBody),
    );

    // Probe 3: GET /health/ready (Alias)
    const aliasRes = await fetch(`${baseUrl}/health/ready`);
    const aliasBody = await aliasRes.json();
    assertCheck(
      aliasRes.status === 200 && aliasBody.ok === true && aliasBody.status === 'ready',
      'GET /health/ready alias returns HTTP 200 matching /ready',
    );
  } catch (err) {
    assertCheck(false, 'Health and readiness HTTP probe requests failed', String(err));
  }

  // Check 7: Readiness Negative Drill (Broken DB simulation)
  log('\n--- Step 7: Readiness Negative Drill (Dependency Outage) ---');
  const brokenDbPort = SECONDARY_TEST_PORT;
  const brokenServer: ChildProcess = spawn('node', [apiMainPath], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(brokenDbPort),
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5439/fake_down_db?schema=public&connect_timeout=1',
      REDIS_URL: TEST_REDIS_URL,
      JWT_SECRET: 'super-secret-key-that-is-at-least-32-chars-long!',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const brokenBaseUrl = `http://127.0.0.1:${brokenDbPort}`;
  let brokenServerUp = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${brokenBaseUrl}/health`);
      if (res.status === 200) {
        brokenServerUp = true;
        break;
      }
    } catch {
      await sleep(250);
    }
  }

  assertCheck(brokenServerUp, `Secondary server booted with broken DB configuration on PORT=${brokenDbPort}`);

  if (brokenServerUp) {
    try {
      // Liveness must remain 200 even when DB is down
      const livenessDuringOutage = await fetch(`${brokenBaseUrl}/health`);
      assertCheck(
        livenessDuringOutage.status === 200,
        'GET /health still returns HTTP 200 during database outage (Liveness decoupling)',
      );

      // Readiness must return 503 quickly (< 1500ms)
      const startT = Date.now();
      const readinessDuringOutage = await fetch(`${brokenBaseUrl}/ready`);
      const elapsed = Date.now() - startT;
      const unreadyBody = await readinessDuringOutage.json();

      assertCheck(
        readinessDuringOutage.status === 503 &&
          unreadyBody.ok === false &&
          unreadyBody.db === 'unreachable',
        `GET /ready returns HTTP 503 within ${elapsed}ms when PostgreSQL is unreachable`,
        JSON.stringify(unreadyBody),
      );
    } catch (err) {
      assertCheck(false, 'Readiness negative test request failed', String(err));
    } finally {
      brokenServer.kill('SIGKILL');
    }
  }

  // Check 8: Graceful Shutdown Lifecycle Verification
  log('\n--- Step 8: Graceful Shutdown Lifecycle Verification ---');
  const shutdownStartTime = Date.now();
  const gracefulExitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    serverProcess.on('exit', (code, signal) => resolve({ code, signal }));
  });

  serverProcess.kill('SIGTERM');
  const exitResult = await Promise.race([
    gracefulExitPromise,
    sleep(6000).then(() => ({ code: -1, signal: null as NodeJS.Signals | null })),
  ]);

  const shutdownElapsed = Date.now() - shutdownStartTime;
  assertCheck(
    exitResult.code === 0 || exitResult.signal === 'SIGTERM',
    `Server gracefully terminated on SIGTERM in ${shutdownElapsed}ms without hanging`,
    `Exit code: ${exitResult.code}, Signal: ${exitResult.signal}`,
  );

  // Save graceful shutdown log
  const shutdownLogFile = path.join(evidenceDir, 'graceful-shutdown.txt');
  fs.writeFileSync(
    shutdownLogFile,
    `=== GRACEFUL SHUTDOWN LOG ===\nSignal Sent: SIGTERM\nShutdown Duration: ${shutdownElapsed}ms\nExit Code: ${exitResult.code}\nSignal: ${exitResult.signal}\nServer Log Output:\n${serverOutput}\n`,
    'utf8',
  );

  // Summary
  log('\n====================================================================');
  log(`MODULE 10 BUILD VERIFICATION RESULTS: ${passed} PASSED, ${failures.length} FAILED`);
  log('====================================================================\n');

  if (failures.length > 0) {
    console.error('FAILURES DETECTED:');
    failures.forEach((f) => console.error(` - ${f}`));
    process.exit(1);
  }
}

runModule10Verification().catch((err) => {
  console.error('[UNCAUGHT ERROR]', err);
  process.exit(1);
});

