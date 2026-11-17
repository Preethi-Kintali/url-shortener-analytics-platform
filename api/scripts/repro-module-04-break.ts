import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://127.0.0.1:3000';
const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-04');
fs.mkdirSync(evidenceDir, { recursive: true });
const logFile = path.join(evidenceDir, 'break-idor-repro.txt');
fs.writeFileSync(logFile, '', 'utf8');

function log(msg: string): void {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n', 'utf8');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.killed || server.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        server.kill('SIGKILL');
      } catch {
        // Ignore
      }
      resolve();
    }, 3000);

    server.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      server.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function main(): Promise<void> {
  log('==========================================================');
  log('Module 04 BREAK Drill: Ownership / IDOR Symptom Reproduction');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('==========================================================\n');

  const apiDir = path.resolve(__dirname, '..');
  const serverScript = path.join(apiDir, 'dist', 'main.js');
  const server = spawn('node', [serverScript], {
    cwd: apiDir,
    stdio: 'pipe',
    shell: false,
  });

  try {
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.status === 200) {
          healthy = true;
          break;
        }
      } catch {
        // Starting
      }
    }
    if (!healthy) {
      throw new Error('Server failed to start or /health timed out.');
    }

    const aliceRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'dev-alice-secret-01' }),
    });
    const aliceBody = (await aliceRes.json()) as { access_token: string; principal_id: string };
    log(`[1] POST /auth/login (Alice) -> HTTP ${aliceRes.status}, principal_id=${aliceBody.principal_id}`);

    const bobRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com', password: 'dev-bob-secret-02' }),
    });
    const bobBody = (await bobRes.json()) as { access_token: string; principal_id: string };
    log(`[2] POST /auth/login (Bob)   -> HTTP ${bobRes.status}, principal_id=${bobBody.principal_id}`);

    const createRes = await fetch(`${BASE_URL}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceBody.access_token}`,
      },
      body: JSON.stringify({ long_url: 'https://example.com/alice-private-campaign' }),
    });
    const aliceLink = (await createRes.json()) as { id: string; code: string; long_url: string; created_by: string };
    log(`[3] POST /links (Alice)      -> HTTP ${createRes.status}, id=${aliceLink.id}, created_by=${aliceLink.created_by}`);

    const unauthGet = await fetch(`${BASE_URL}/links/${aliceLink.id}`);
    log(`[4] GET /links/${aliceLink.id} (No token) -> HTTP ${unauthGet.status}`);

    const bobGet = await fetch(`${BASE_URL}/links/${aliceLink.id}`, {
      headers: { Authorization: `Bearer ${bobBody.access_token}` },
    });
    const bobGetBody = await bobGet.text();
    log(`[5] GET /links/${aliceLink.id} (Bob JWT)  -> HTTP ${bobGet.status} (EXPECTED: HTTP 404)`);
    log(`    Response Body: ${bobGetBody}`);

    // Cleanup Alice's temporary link
    await fetch(`${BASE_URL}/links/${aliceLink.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${aliceBody.access_token}` },
    });

    log('\n==========================================================');
    if (bobGet.status === 200) {
      log('REPRODUCED: Cross-principal read succeeded (HTTP 200) — IDOR vulnerability confirmed!');
    } else {
      log(`UNEXPECTED: Received HTTP ${bobGet.status} instead of reproducing 200.`);
      process.exitCode = 1;
    }
    log('==========================================================');
  } finally {
    await stopServer(server);
    log(`Evidence saved to: ${logFile}`);
  }
}

main().catch((err) => {
  console.error('[BREAK REPRO ERROR]', err);
  process.exit(1);
});

