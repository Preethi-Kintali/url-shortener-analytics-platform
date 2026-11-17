import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-03');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}
const logFile = path.join(evidenceDir, 'api-tests.txt');
fs.writeFileSync(logFile, '', 'utf8');

function log(msg: string) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n', 'utf8');
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  log('==================================================');
  log('Module 03: Core API & Security Abuse Drill');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('==================================================\n');

  const apiDir = path.resolve(__dirname, '..');
  const serverScript = path.join(apiDir, 'dist', 'main.js');

  log(`[SETUP] Spawning NestJS API from: ${serverScript}`);
  const server = spawn('node', [serverScript], {
    cwd: apiDir,
    stdio: 'pipe',
    shell: false,
  });

  server.stdout?.on('data', (d) => process.stdout.write(`[SERVER] ${d}`));
  server.stderr?.on('data', (d) => process.stderr.write(`[SERVER ERR] ${d}`));

  let healthy = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const res = await fetch('http://localhost:3000/health');
      if (res.status === 200) {
        healthy = true;
        break;
      }
    } catch (_) {}
  }

  if (!healthy) {
    server.kill();
    throw new Error('Server failed to start or health check timed out.');
  }
  log('[SETUP] Server is live and healthy on port 3000.\n');

  // STEP 1: Health Check
  log('--- STEP 1: Verify Health Endpoint ---');
  const healthRes = await fetch('http://localhost:3000/health');
  const healthBody = await healthRes.json();
  log(`GET /health -> HTTP ${healthRes.status} ${JSON.stringify(healthBody)}\n`);

  // STEP 2: Security Validation Abuse Matrix (10 test cases)
  log('--- STEP 2: Security Validation Abuse Matrix (Expect HTTP 400) ---');
  const abuseCases = [
    { name: 'Direct JavaScript Scheme', url: 'javascript:alert(1)' },
    { name: 'Case-Insensitive Bypass', url: 'JaVaScRiPt:alert(1)' },
    { name: 'Whitespace Evasion', url: '  javascript:alert(1)  ' },
    { name: 'Data URI Payload', url: 'data:text/html,<svg/onload=alert(1)>' },
    { name: 'Scheme-Relative Bypass', url: '//evil.example.com' },
    { name: 'Encoded Slashes', url: 'http:%2f%2fevil.example.com' },
    { name: 'Encoded Scheme', url: 'http%3A%2F%2Fevil.example.com' },
    { name: 'Backslash Authority', url: 'http:\\evil.example.com' },
    { name: 'Userinfo Phishing Trick', url: 'https://good.com@evil.example.com' },
    { name: 'Control Characters / Newline', url: 'https://example.com\n' },
  ];

  let abusePassed = 0;
  for (const tc of abuseCases) {
    const res = await fetch('http://localhost:3000/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ long_url: tc.url }),
    });

    const body = await res.json();
    if (res.status === 400) {
      abusePassed++;
      log(`[PASSED (400)] ${tc.name} -> Payload: '${tc.url.replace('\n', '\\n')}'`);
      log(`   Response: ${JSON.stringify(body)}`);
    } else {
      log(`[FAILED (${res.status})] ${tc.name} -> Expected 400, got ${res.status}: ${JSON.stringify(body)}`);
    }
  }
  log(`\nAbuse Matrix Result: ${abusePassed} / ${abuseCases.length} malicious payloads rejected with HTTP 400.\n`);

  // STEP 3: Valid Link Creation
  log('--- STEP 3: Valid Link Creation (POST /links) ---');
  const validUrl = 'https://example.com/dest-module-03-verified';
  const createRes = await fetch('http://localhost:3000/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ long_url: validUrl }),
  });
  const createBody = (await createRes.json()) as any;
  log(`POST /links -> HTTP ${createRes.status}`);
  log(`Response: ${JSON.stringify(createBody, null, 2)}\n`);

  const createdId = createBody.id;
  const createdCode = createBody.code;

  // STEP 4: List Links (GET /links)
  log('--- STEP 4: List Links (GET /links) ---');
  const listRes = await fetch('http://localhost:3000/links?page=1&limit=5');
  const listBody = await listRes.json();
  log(`GET /links?page=1&limit=5 -> HTTP ${listRes.status}`);
  log(`Response: ${JSON.stringify(listBody, null, 2)}\n`);

  // STEP 5: Inspect Link by ID (GET /links/:id)
  log(`--- STEP 5: Inspect Link by ID (GET /links/${createdId}) ---`);
  const getRes = await fetch(`http://localhost:3000/links/${createdId}`);
  const getBody = await getRes.json();
  log(`GET /links/${createdId} -> HTTP ${getRes.status}`);
  log(`Response: ${JSON.stringify(getBody, null, 2)}\n`);

  // STEP 6: Public Redirect (GET /r/:code)
  log(`--- STEP 6: Public Redirect (GET /r/${createdCode}) ---`);
  const redirRes = await fetch(`http://localhost:3000/r/${createdCode}`, {
    redirect: 'manual',
  });
  const locationHeader = redirRes.headers.get('location');
  log(`GET /r/${createdCode} -> HTTP ${redirRes.status}`);
  log(`Location Header: ${locationHeader}\n`);

  // STEP 7: Unknown Code Redirect (Expect 404)
  log('--- STEP 7: Unknown Code Redirect (GET /r/nonexistent_code_999) ---');
  const notFoundRes = await fetch('http://localhost:3000/r/nonexistent_code_999', {
    redirect: 'manual',
  });
  const notFoundBody = await notFoundRes.json();
  log(`GET /r/nonexistent_code_999 -> HTTP ${notFoundRes.status}`);
  log(`Response: ${JSON.stringify(notFoundBody, null, 2)}\n`);

  // TEARDOWN
  log('[TEARDOWN] Stopping API server...');
  server.kill('SIGTERM');
  await sleep(1000);
  log(`Verification complete. All results saved to: ${logFile}`);
}

main().catch((err) => {
  console.error('[TEST SUITE ERROR]', err);
  process.exit(1);
});

