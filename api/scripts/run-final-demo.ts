import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const BASE_URL = 'http://localhost:3128';
const TEST_PORT = 3128;
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/upsk_sdf_test?schema=public';
const TEST_REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';
const DOCKER_CONTAINER_NAME = 'bootcamp-api-demo';

const notebookPath = path.resolve(__dirname, '../../progress/lab-notebook.md');

function runCmd(cmd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, { encoding: 'utf8', shell: true });
  return {
    code: res.status ?? (res.error ? 1 : 0),
    stdout: res.stdout || '',
    stderr: res.stderr || (res.error ? String(res.error) : ''),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== STARTING FINAL DEMO SCRIPT EXECUTION ===');

  // Pre-flight checks
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  const redis = new Redis(TEST_REDIS_URL);

  let workerProc: ChildProcess | null = null;
  let linkId: string | null = null;

  try {
    await prisma.$connect();
    const dbNameRes = await prisma.$queryRawUnsafe<Array<{ current_database: string }>>(
      'SELECT current_database();',
    );
    if (dbNameRes[0]?.current_database !== 'upsk_sdf_test') {
      throw new Error(`Safety violation: Database is ${dbNameRes[0]?.current_database}, expected upsk_sdf_test`);
    }

    const redisInfo = await redis.info();
    const redisDbMatch = redisInfo.match(/db1:keys=(\d+)/);
    console.log(`Pre-flight: Test DB connected (upsk_sdf_test). Redis DB 1 active (${redisDbMatch ? redisDbMatch[0] : 'empty'}).`);

    // Remove existing container if present
    runCmd('docker', ['rm', '-f', DOCKER_CONTAINER_NAME]);

    // Start background worker
    console.log('Starting background worker (dist/worker.js)...');
    workerProc = spawn(
      'node',
      ['dist/worker.js'],
      {
        cwd: path.resolve(__dirname, '..'),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_URL: TEST_DATABASE_URL,
          REDIS_URL: TEST_REDIS_URL,
          JWT_SECRET: 'super-secret-key-that-is-at-least-32-chars-long!',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let workerLogs = '';
    workerProc.stdout?.on('data', (d) => (workerLogs += d.toString()));
    workerProc.stderr?.on('data', (d) => (workerLogs += d.toString()));

    // Start Docker container with host-gateway mapping
    console.log('Starting Docker container (bootcamp-api-demo)...');
    const runRes = runCmd('docker', [
      'run',
      '-d',
      '--name',
      DOCKER_CONTAINER_NAME,
      '--add-host=host.docker.internal:host-gateway',
      '-p',
      `${TEST_PORT}:3000`,
      '-e',
      'PORT=3000',
      '-e',
      'NODE_ENV=test',
      '-e',
      'DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/upsk_sdf_test?schema=public',
      '-e',
      'REDIS_URL=redis://host.docker.internal:6379/1',
      '-e',
      'JWT_SECRET=super-secret-key-that-is-at-least-32-chars-long!',
      'bootcamp-api:latest',
    ]);

    if (runRes.code !== 0) {
      throw new Error(`Failed to start Docker container: ${runRes.stderr}`);
    }

    console.log(`Container started: ${runRes.stdout.trim()}`);

    // Wait for container readiness
    let isReady = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${BASE_URL}/ready`);
        if (res.status === 200) {
          isReady = true;
          break;
        }
      } catch {}
      await sleep(250);
    }

    if (!isReady) {
      const logs = runCmd('docker', ['logs', DOCKER_CONTAINER_NAME]);
      throw new Error(`Container failed to become ready. Logs:\n${logs.stdout}\n${logs.stderr}`);
    }
    console.log('API container is healthy and ready.');

    const logEntries: string[] = [];
    logEntries.push('# Module 10: Final Demo Script Execution Log');
    logEntries.push(`**Executed at:** ${new Date().toISOString()}`);
    logEntries.push(`**Environment:** Docker container (\`bootcamp-api:latest\`) on port ${TEST_PORT}, connected to \`upsk_sdf_test\` and Redis DB 1.\n`);

    // Helper to record curl execution
    function recordCurl(stepTitle: string, displayCmd: string, curlArgs: string[]): { code: number; stdout: string; stderr: string } {
      console.log(`\n--- ${stepTitle} ---`);
      console.log(`> ${displayCmd}`);
      const res = spawnSync('curl.exe', curlArgs, { encoding: 'utf8' });
      const out = {
        code: res.status ?? (res.error ? 1 : 0),
        stdout: res.stdout || '',
        stderr: res.stderr || (res.error ? String(res.error) : ''),
      };
      console.log(out.stdout || out.stderr);

      logEntries.push(`## ${stepTitle}`);
      logEntries.push('```powershell');
      logEntries.push(`> ${displayCmd}`);
      logEntries.push('```');
      logEntries.push('**Output:**');
      logEntries.push('```text');
      logEntries.push(out.stdout ? out.stdout.trim() : out.stderr.trim());
      logEntries.push('```\n');
      return out;
    }

    // 1) Health + Readiness
    recordCurl('1) Health Check (Liveness)', `curl.exe -fsS ${BASE_URL}/health`, ['-fsS', `${BASE_URL}/health`]);
    recordCurl('1) Readiness Check', `curl.exe -fsS ${BASE_URL}/ready`, ['-fsS', `${BASE_URL}/ready`]);

    // Auth setup (get token)
    const authDisplay = `curl.exe -s -X POST ${BASE_URL}/auth/login -H "Content-Type: application/json" -d '{"email":"alice@example.com","password":"dev-alice-secret-01"}'`;
    const authOut = recordCurl('Auth Login (Alice)', authDisplay, [
      '-s',
      '-X',
      'POST',
      `${BASE_URL}/auth/login`,
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ email: 'alice@example.com', password: 'dev-alice-secret-01' }),
    ]);
    const authData = JSON.parse(authOut.stdout.trim());
    const token = authData.access_token;
    if (!token) throw new Error(`Failed to retrieve JWT token for Alice: ${authOut.stdout}`);

    // 2) Create Link (Protected)
    // 2a: Unauthenticated
    recordCurl('2a) Create Link Without Auth (401 Expected)', `curl.exe -i ${BASE_URL}/links`, ['-i', `${BASE_URL}/links`]);

    // 2b: Authenticated
    const createDisplay = `curl.exe -i -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" -d '{"long_url":"https://example.com/demo-test-module-10"}' ${BASE_URL}/links`;
    const createOut = recordCurl('2b) Create Link With Auth (201 Expected)', createDisplay, [
      '-i',
      '-H',
      `Authorization: Bearer ${token}`,
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ long_url: 'https://example.com/demo-test-module-10' }),
      `${BASE_URL}/links`,
    ]);

    // Extract link code and id
    const bodyPart = createOut.stdout.split('\r\n\r\n').pop() || createOut.stdout.split('\n\n').pop() || '';
    const jsonMatch = bodyPart.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Could not parse create link response JSON: ${createOut.stdout}`);
    const createdLink = JSON.parse(jsonMatch[0]);
    const linkCode = createdLink.code;
    linkId = createdLink.id;
    console.log(`Created link: code=${linkCode}, id=${linkId}`);

    // 3) Redirect (Public)
    recordCurl('3) Public Redirect 1 (/r/<CODE>)', `curl.exe -i ${BASE_URL}/r/${linkCode}`, ['-i', `${BASE_URL}/r/${linkCode}`]);
    recordCurl('3) Public Redirect 2 (/r/<CODE>)', `curl.exe -i ${BASE_URL}/r/${linkCode}`, ['-i', `${BASE_URL}/r/${linkCode}`]);

    // 4) Analytics Updated
    // Wait for worker to process click events
    console.log('Waiting 2000ms for worker to process analytics...');
    await sleep(2000);
    const analyticsDisplay = `curl.exe -i -H "Authorization: Bearer <TOKEN>" "${BASE_URL}/links/${linkId}/analytics?from=2000-01-01&to=2100-01-01"`;
    recordCurl('4) Analytics Updated (Protected)', analyticsDisplay, [
      '-i',
      '-H',
      `Authorization: Bearer ${token}`,
      `${BASE_URL}/links/${linkId}/analytics?from=2000-01-01&to=2100-01-01`,
    ]);

    // 5) Cache Invalidation Proof
    const patchDisplay = `curl.exe -i -X PATCH "${BASE_URL}/links/${linkId}" -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" -d '{"long_url":"https://example.org/demo-test-updated"}'`;
    recordCurl('5a) Update Link (Protected PATCH)', patchDisplay, [
      '-i',
      '-X',
      'PATCH',
      `${BASE_URL}/links/${linkId}`,
      '-H',
      `Authorization: Bearer ${token}`,
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ long_url: 'https://example.org/demo-test-updated' }),
    ]);

    recordCurl(
      '5b) Public Redirect Post-Update (Cache Invalidation Proof)',
      `curl.exe -i ${BASE_URL}/r/${linkCode}`,
      ['-i', `${BASE_URL}/r/${linkCode}`],
    );

    // 6) Search + Pagination
    const searchDisplay = `curl.exe -i -H "Authorization: Bearer <TOKEN>" "${BASE_URL}/links/search?q=demo-test&page=1&page_size=10"`;
    recordCurl('6) Search + Pagination (Protected)', searchDisplay, [
      '-i',
      '-H',
      `Authorization: Bearer ${token}`,
      `${BASE_URL}/links/search?q=demo-test&page=1&page_size=10`,
    ]);

    // 7) Graceful Shutdown
    console.log('\n--- 7) Graceful Shutdown ---');
    const t0 = Date.now();
    const stopOut = runCmd('docker', ['stop', DOCKER_CONTAINER_NAME]);
    const stopDuration = Date.now() - t0;
    console.log(`Container stopped in ${stopDuration}ms`);

    const inspectRes = runCmd('docker', ['inspect', DOCKER_CONTAINER_NAME, '--format', '{{.State.ExitCode}}']);
    const exitCode = inspectRes.stdout.trim();

    const logsOut = runCmd('docker', ['logs', DOCKER_CONTAINER_NAME]);

    logEntries.push('## 7) Graceful Shutdown');
    logEntries.push('```powershell');
    logEntries.push(`> docker stop ${DOCKER_CONTAINER_NAME}`);
    logEntries.push('```');
    logEntries.push(`**Stop Duration:** ${stopDuration}ms | **Exit Code:** ${exitCode}\n`);
    logEntries.push('**Container Logs:**');
    logEntries.push('```text');
    logEntries.push(logsOut.stdout || logsOut.stderr);
    logEntries.push('```\n');

    // Append to progress/lab-notebook.md
    fs.writeFileSync(notebookPath, logEntries.join('\n'), 'utf8');
    console.log(`Successfully written demo script results to ${notebookPath}`);
    console.log('=== DEMO SCRIPT COMPLETED SUCCESSFULLY ===');
  } finally {
    if (workerProc) {
      workerProc.kill('SIGTERM');
    }
    if (linkId) {
      await prisma.clickEvent.deleteMany({ where: { linkId } }).catch(() => {});
      await prisma.link.deleteMany({ where: { id: linkId } }).catch(() => {});
    }
    await prisma.$disconnect().catch(() => {});
    await redis.quit().catch(() => {});
    runCmd('docker', ['rm', '-f', DOCKER_CONTAINER_NAME]);
  }
}

main().catch((err) => {
  console.error('[DEMO FAILED]', err);
  process.exit(1);
});
