import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const PORT = '3107';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-05');
fs.mkdirSync(evidenceDir, { recursive: true });
const logFile = path.join(evidenceDir, 'break-pii-repro.txt');
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
  log('Module 05 BREAK Drill: Error Log PII Symptom Reproduction');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('==========================================================\n');

  const apiDir = path.resolve(__dirname, '..');
  const serverScript = path.join(apiDir, 'dist', 'main.js');
  const server = spawn('node', [serverScript], {
    cwd: apiDir,
    env: { ...process.env, PORT },
    stdio: 'pipe',
    shell: false,
  });

  const serverOutputLines: string[] = [];
  server.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.trim()) serverOutputLines.push(line.trim());
    }
  });
  server.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.trim()) serverOutputLines.push(line.trim());
    }
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

    const requestId = 'req-break-m5-01';
    const syntheticEmail = 'jane.doe@example.com';
    const syntheticIp = '203.0.113.42';

    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
        'X-Forwarded-For': syntheticIp,
      },
      body: JSON.stringify({
        email: syntheticEmail,
        password: 'wrong-pass-attempt-01',
      }),
    });

    const bodyText = await res.text();
    log('[1] Request Sent:');
    log(`    POST /auth/login (X-Request-Id: ${requestId}, X-Forwarded-For: ${syntheticIp})`);
    log(`    Body: {"email":"${syntheticEmail}","password":"[redacted-by-client-script]"}\n`);

    log('[2] Client HTTP Response Received:');
    log(`    Status: HTTP ${res.status}`);
    log(`    X-Request-Id Header: ${res.headers.get('x-request-id')}`);
    log(`    Response Body: ${bodyText}\n`);

    await sleep(200);
    const matchingLogs = serverOutputLines.filter((line) => line.includes(requestId));

    log('[3] Server Structured Logs Recorded for request_id:');
    for (const line of matchingLogs) {
      log(`    ${line}`);
    }

    const leakedEmail = matchingLogs.some((line) => line.includes(syntheticEmail));
    const leakedIp = matchingLogs.some((line) => line.includes(syntheticIp));
    const cleanClient = !bodyText.includes(syntheticEmail) && !bodyText.includes(syntheticIp);

    log('\n==========================================================');
    if (res.status === 401 && cleanClient && leakedEmail && leakedIp) {
      log('REPRODUCED: Client HTTP 401 response looks clean, while server error logs expose user email and IP PII.');
    } else {
      log(`UNEXPECTED: status=${res.status}, cleanClient=${cleanClient}, leakedEmail=${leakedEmail}, leakedIp=${leakedIp}`);
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

