import { ChildProcess, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getJwtSecret } from '../src/config/validate-env';

const BASE_URL = 'http://127.0.0.1:3000';
const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-04');
fs.mkdirSync(evidenceDir, { recursive: true });
const logFile = path.join(evidenceDir, 'auth-ratelimit-tests.txt');
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

function decodeJwtClaims(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT structure');
  }
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

function createExpiredHs256Jwt(principalId: string, email: string, secret: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({
      sub: principalId,
      principal_id: principalId,
      email,
      iat: nowSeconds - 1200,
      exp: nowSeconds - 300,
    }),
  ).toString('base64url');
  const signatureB64 = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signatureB64}`;
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
        // Ignore kill error if already exited
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
  log('Module 04: Auth, Ownership & Rate Limit Verification Suite');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('==========================================================\n');

  const apiDir = path.resolve(__dirname, '..');
  const serverScript = path.join(apiDir, 'dist', 'main.js');
  const jwtSecret = getJwtSecret();

  log(`[SETUP] Spawning NestJS API from: ${serverScript}`);
  const server = spawn('node', [serverScript], {
    cwd: apiDir,
    stdio: 'pipe',
    shell: false,
  });

  server.stdout?.on('data', (chunk) => process.stdout.write(`[SERVER] ${chunk}`));
  server.stderr?.on('data', (chunk) => process.stderr.write(`[SERVER ERR] ${chunk}`));

  let loginRequestsSent = 0;
  let createLinkRequestsSent = 0;
  let redirectRequestsSent = 0;

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
        // Server still starting
      }
    }

    if (!healthy) {
      throw new Error('Server failed to start or /health timed out.');
    }
    log('[SETUP] API server is live and healthy.\n');

    // Initial Health Check
    log('--- Baseline: Health Endpoint ---');
    const healthInit = await fetch(`${BASE_URL}/health`);
    const healthInitBody = (await healthInit.json()) as { ok?: boolean };
    assertCheck(
      healthInit.status === 200 && healthInitBody.ok === true,
      'GET /health returns 200 { ok: true }',
      `status=${healthInit.status}, body=${JSON.stringify(healthInitBody)}`,
    );
    log('');

    // SECTION A: AUTHENTICATION
    log('--- SECTION A: Authentication Tests ---');

    const unauthGetAll = await fetch(`${BASE_URL}/links`);
    assertCheck(unauthGetAll.status === 401, 'GET /links without token returns 401', `status=${unauthGetAll.status}`);

    createLinkRequestsSent++;
    const unauthPost = await fetch(`${BASE_URL}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ long_url: 'https://example.com/unauth' }),
    });
    assertCheck(unauthPost.status === 401, 'POST /links without token returns 401', `status=${unauthPost.status}`);

    const unauthPatch = await fetch(`${BASE_URL}/links/nonexistent-id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ long_url: 'https://example.com/unauth-patch' }),
    });
    assertCheck(unauthPatch.status === 401, 'PATCH /links/:id without token returns 401', `status=${unauthPatch.status}`);

    const unauthDelete = await fetch(`${BASE_URL}/links/nonexistent-id`, {
      method: 'DELETE',
    });
    assertCheck(unauthDelete.status === 401, 'DELETE /links/:id without token returns 401', `status=${unauthDelete.status}`);

    const malformedAuth = await fetch(`${BASE_URL}/links`, {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    assertCheck(malformedAuth.status === 401, 'GET /links with non-Bearer auth returns 401', `status=${malformedAuth.status}`);

    loginRequestsSent++;
    const wrongLogin = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'wrong-password-123' }),
    });
    assertCheck(wrongLogin.status === 401, 'POST /auth/login with wrong password returns 401', `status=${wrongLogin.status}`);

    loginRequestsSent++;
    const aliceLoginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'dev-alice-secret-01' }),
    });
    const aliceLoginBody = (await aliceLoginRes.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      principal_id: string;
    };
    const aliceClaims = decodeJwtClaims(aliceLoginBody.access_token || '');
    const aliceTtl =
      typeof aliceClaims.exp === 'number' && typeof aliceClaims.iat === 'number'
        ? aliceClaims.exp - aliceClaims.iat
        : -1;
    assertCheck(
      aliceLoginRes.status === 200 &&
        aliceLoginBody.token_type === 'Bearer' &&
        aliceLoginBody.expires_in === 900 &&
        aliceLoginBody.principal_id === 'principal_a' &&
        aliceClaims.principal_id === 'principal_a' &&
        aliceTtl === 900,
      'Alice login succeeds with 15-min JWT containing principal_id',
      `status=${aliceLoginRes.status}, expires_in=${aliceLoginBody.expires_in}, claims=${JSON.stringify(aliceClaims)}`,
    );

    loginRequestsSent++;
    const bobLoginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com', password: 'dev-bob-secret-02' }),
    });
    const bobLoginBody = (await bobLoginRes.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      principal_id: string;
    };
    const bobClaims = decodeJwtClaims(bobLoginBody.access_token || '');
    assertCheck(
      bobLoginRes.status === 200 &&
        bobLoginBody.principal_id === 'principal_b' &&
        bobLoginBody.expires_in === 900 &&
        bobClaims.principal_id === 'principal_b',
      'Bob login succeeds with JWT containing principal_b',
      `status=${bobLoginRes.status}, principal_id=${bobLoginBody.principal_id}`,
    );

    const tokenA = aliceLoginBody.access_token;
    const tokenB = bobLoginBody.access_token;

    const validJwtGet = await fetch(`${BASE_URL}/links`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assertCheck(validJwtGet.status === 200, 'GET /links with valid JWT returns 200', `status=${validJwtGet.status}`);

    const invalidJwtGet = await fetch(`${BASE_URL}/links`, {
      headers: { Authorization: 'Bearer not.a.validjwt' },
    });
    assertCheck(invalidJwtGet.status === 401, 'GET /links with malformed/invalid JWT returns 401', `status=${invalidJwtGet.status}`);

    const expiredJwt = createExpiredHs256Jwt('principal_a', 'alice@example.com', jwtSecret);
    const expiredJwtGet = await fetch(`${BASE_URL}/links`, {
      headers: { Authorization: `Bearer ${expiredJwt}` },
    });
    assertCheck(expiredJwtGet.status === 401, 'GET /links with expired HS256 JWT returns 401', `status=${expiredJwtGet.status}`);
    log('');

    // SECTION B: AUTHORIZATION, OWNERSHIP & URL VALIDATION REGRESSION
    log('--- SECTION B: Authorization, Ownership & URL Security Regression ---');

    createLinkRequestsSent++;
    const createARes = await fetch(`${BASE_URL}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ long_url: 'https://example.com/m4-owned-by-a' }),
    });
    const linkA = (await createARes.json()) as {
      id: string;
      code: string;
      long_url: string;
      created_by: string;
    };
    assertCheck(
      createARes.status === 201 &&
        typeof linkA.id === 'string' &&
        typeof linkA.code === 'string' &&
        linkA.created_by === 'principal_a',
      'Principal A creates owned link with created_by=principal_a',
      `status=${createARes.status}, id=${linkA.id}, code=${linkA.code}, created_by=${linkA.created_by}`,
    );

    const unauthGetRealId = await fetch(`${BASE_URL}/links/${linkA.id}`);
    assertCheck(
      unauthGetRealId.status === 401,
      'Unauthenticated GET /links/:id for existing link returns 401',
      `status=${unauthGetRealId.status}`,
    );

    const ownerReadA = await fetch(`${BASE_URL}/links/${linkA.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const ownerReadABody = (await ownerReadA.json()) as { id?: string; created_by?: string };
    assertCheck(
      ownerReadA.status === 200 && ownerReadABody.id === linkA.id && ownerReadABody.created_by === 'principal_a',
      'Principal A can inspect own link (200)',
      `status=${ownerReadA.status}`,
    );

    const bReadA = await fetch(`${BASE_URL}/links/${linkA.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const bReadAText = await bReadA.text();
    assertCheck(
      bReadA.status === 404 &&
        !bReadAText.includes(linkA.long_url) &&
        !bReadAText.includes('principal_a'),
      'Principal B GET /links/:id on A link returns 404 without leakage',
      `status=${bReadA.status}, body=${bReadAText}`,
    );

    const bPatchA = await fetch(`${BASE_URL}/links/${linkA.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({ long_url: 'https://example.com/hijack-attempt' }),
    });
    const bPatchAText = await bPatchA.text();
    assertCheck(
      bPatchA.status === 404 && !bPatchAText.includes('principal_a') && !bPatchAText.includes(linkA.long_url),
      'Principal B PATCH /links/:id on A link returns 404 without leakage',
      `status=${bPatchA.status}, body=${bPatchAText}`,
    );

    const bDeleteA = await fetch(`${BASE_URL}/links/${linkA.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const bDeleteAText = await bDeleteA.text();
    assertCheck(
      bDeleteA.status === 404 && !bDeleteAText.includes('principal_a') && !bDeleteAText.includes(linkA.long_url),
      'Principal B DELETE /links/:id on A link returns 404 without leakage',
      `status=${bDeleteA.status}, body=${bDeleteAText}`,
    );

    // Create one link as Principal B to verify scoped listing works positively for B and excludes A
    createLinkRequestsSent++;
    const createBRes = await fetch(`${BASE_URL}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({ long_url: 'https://example.com/m4-owned-by-b' }),
    });
    const linkB = (await createBRes.json()) as { id: string; created_by: string };
    assertCheck(
      createBRes.status === 201 && linkB.created_by === 'principal_b',
      'Principal B creates own link with created_by=principal_b',
      `status=${createBRes.status}, id=${linkB.id}`,
    );

    const bListRes = await fetch(`${BASE_URL}/links?page=1&limit=100`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const bListBody = (await bListRes.json()) as {
      data: Array<{ id: string; created_by: string }>;
    };
    const bListHasA = bListBody.data.some((item) => item.id === linkA.id || item.created_by === 'principal_a');
    const bListHasB = bListBody.data.some((item) => item.id === linkB.id && item.created_by === 'principal_b');
    assertCheck(
      bListRes.status === 200 && !bListHasA && bListHasB,
      'Principal B GET /links returns only B links and excludes A links',
      `status=${bListRes.status}, count=${bListBody.data.length}, hasA=${bListHasA}, hasB=${bListHasB}`,
    );

    // Confirm A's link remained intact after B's 404 mutation attempts
    const aVerifyIntact = await fetch(`${BASE_URL}/links/${linkA.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const aVerifyIntactBody = (await aVerifyIntact.json()) as { long_url?: string };
    assertCheck(
      aVerifyIntact.status === 200 && aVerifyIntactBody.long_url === 'https://example.com/m4-owned-by-a',
      'Principal A link remains unmodified after B 404 PATCH/DELETE attempts',
      `status=${aVerifyIntact.status}, long_url=${aVerifyIntactBody.long_url}`,
    );

    // Owner invalid PATCH rejected with 400
    const aInvalidPatch = await fetch(`${BASE_URL}/links/${linkA.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ long_url: 'javascript:alert(1)' }),
    });
    assertCheck(
      aInvalidPatch.status === 400,
      'Owner PATCH /links/:id with javascript: scheme rejected with 400',
      `status=${aInvalidPatch.status}`,
    );

    // Owner valid PATCH succeeds
    const updatedUrl = 'https://example.com/m4-updated-by-a';
    const aValidPatch = await fetch(`${BASE_URL}/links/${linkA.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ long_url: updatedUrl }),
    });
    const aValidPatchBody = (await aValidPatch.json()) as { long_url?: string };
    assertCheck(
      aValidPatch.status === 200 && aValidPatchBody.long_url === updatedUrl,
      'Owner PATCH /links/:id with valid https URL succeeds (200)',
      `status=${aValidPatch.status}, long_url=${aValidPatchBody.long_url}`,
    );

    // Owner create + delete lifecycle
    createLinkRequestsSent++;
    const tempCreateRes = await fetch(`${BASE_URL}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ long_url: 'https://example.com/m4-temp-delete' }),
    });
    const tempLink = (await tempCreateRes.json()) as { id: string };
    const aDeleteTemp = await fetch(`${BASE_URL}/links/${tempLink.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const aDeleteTempBody = (await aDeleteTemp.json()) as { deleted?: boolean; id?: string };
    const aGetAfterDelete = await fetch(`${BASE_URL}/links/${tempLink.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assertCheck(
      tempCreateRes.status === 201 &&
        aDeleteTemp.status === 200 &&
        aDeleteTempBody.deleted === true &&
        aGetAfterDelete.status === 404,
      'Owner DELETE /links/:id deletes own link and follow-up GET returns 404',
      `create=${tempCreateRes.status}, delete=${aDeleteTemp.status}, after=${aGetAfterDelete.status}`,
    );

    // Authenticated Module 03 Security Abuse Matrix Regression (10 cases)
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
      createLinkRequestsSent++;
      const res = await fetch(`${BASE_URL}/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({ long_url: tc.url }),
      });
      if (res.status === 400) {
        abusePassed++;
      } else {
        log(`[DETAIL] Abuse case "${tc.name}" returned ${res.status}`);
      }
    }
    assertCheck(
      abusePassed === abuseCases.length,
      'Module 03 10-case malicious URL abuse matrix passes (authenticated as Principal A)',
      `${abusePassed}/${abuseCases.length} rejected with HTTP 400`,
    );
    log('');

    // SECTION C: PUBLIC REDIRECT
    log('--- SECTION C: Public Redirect Tests ---');

    redirectRequestsSent++;
    const publicRedir = await fetch(`${BASE_URL}/r/${linkA.code}`, { redirect: 'manual' });
    const locationHeader = publicRedir.headers.get('location');
    assertCheck(
      publicRedir.status === 302 && locationHeader === updatedUrl,
      'Unauthenticated GET /r/:code returns 302 with updated Location',
      `status=${publicRedir.status}, location=${locationHeader}`,
    );

    redirectRequestsSent++;
    const unknownRedir = await fetch(`${BASE_URL}/r/unknown_m4_code`, { redirect: 'manual' });
    assertCheck(
      unknownRedir.status === 404,
      'Unauthenticated GET /r/unknown_m4_code returns 404',
      `status=${unknownRedir.status}`,
    );
    log('');

    // SECTION D: RATE LIMITING (10/min login, 30/min create, 120/min redirect)
    log('--- SECTION D: Rate Limiting Tests (HTTP 429 Enforcement) ---');

    // D1: Login rate limit (10/min)
    const loginStatuses: number[] = [];
    let loginOkAfterPrior = 0;
    let login429Count = 0;
    while (loginRequestsSent < 15) {
      loginRequestsSent++;
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alice@example.com', password: 'dev-alice-secret-01' }),
      });
      loginStatuses.push(res.status);
      if (loginRequestsSent <= 10 && res.status === 200) {
        loginOkAfterPrior++;
      } else if (loginRequestsSent > 10 && res.status === 429) {
        login429Count++;
      }
    }
    assertCheck(
      loginOkAfterPrior === 7 && login429Count === 5,
      'Login rate limit enforces 10 req/min then HTTP 429',
      `requests 4..15 statuses=[${loginStatuses.join(',')}]`,
    );

    // D2: Create link rate limit (30/min)
    const createPrior = createLinkRequestsSent;
    const createdBurstIds: string[] = [];
    const createStatuses: number[] = [];
    let createWithinLimitOk = 0;
    let create429Count = 0;
    const expectedWithinLimitCreates = 30 - createPrior;
    while (createLinkRequestsSent < 35) {
      createLinkRequestsSent++;
      const res = await fetch(`${BASE_URL}/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({ long_url: `https://example.com/m4-burst-${createLinkRequestsSent}` }),
      });
      createStatuses.push(res.status);
      if (res.status === 201) {
        const body = (await res.json()) as { id?: string };
        if (body.id) {
          createdBurstIds.push(body.id);
        }
        if (createLinkRequestsSent <= 30) {
          createWithinLimitOk++;
        }
      } else if (createLinkRequestsSent > 30 && res.status === 429) {
        create429Count++;
      }
    }
    assertCheck(
      createWithinLimitOk === expectedWithinLimitCreates && create429Count === 5,
      'Create link rate limit enforces 30 req/min then HTTP 429',
      `prior=${createPrior}, withinLimitOk=${createWithinLimitOk}/${expectedWithinLimitCreates}, blocked429=${create429Count}, statuses=[${createStatuses.join(',')}]`,
    );

    // D3: Redirect rate limit (120/min)
    const redirectPrior = redirectRequestsSent;
    const redirectStatuses: number[] = [];
    let redirectWithinLimitOk = 0;
    let redirect429Count = 0;
    const expectedWithinLimitRedirects = 120 - redirectPrior;
    while (redirectRequestsSent < 125) {
      redirectRequestsSent++;
      const res = await fetch(`${BASE_URL}/r/${linkA.code}`, { redirect: 'manual' });
      redirectStatuses.push(res.status);
      if (redirectRequestsSent <= 120 && res.status === 302) {
        redirectWithinLimitOk++;
      } else if (redirectRequestsSent > 120 && res.status === 429) {
        redirect429Count++;
      }
    }
    assertCheck(
      redirectWithinLimitOk === expectedWithinLimitRedirects && redirect429Count === 5,
      'Redirect rate limit enforces 120 req/min then HTTP 429',
      `prior=${redirectPrior}, withinLimitOk=${redirectWithinLimitOk}/${expectedWithinLimitRedirects}, blocked429=${redirect429Count}, tailStatuses=[${redirectStatuses.slice(-10).join(',')}]`,
    );

    // Cleanup burst links created during D2 (and test link B)
    for (const burstId of createdBurstIds) {
      await fetch(`${BASE_URL}/links/${burstId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenA}` },
      });
    }
    await fetch(`${BASE_URL}/links/${linkB.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    });

    // Final Health Check Regression after 429 exhaustion
    log('');
    log('--- Post-Burst Regression: Health Check ---');
    const healthFinal = await fetch(`${BASE_URL}/health`);
    const healthFinalBody = (await healthFinal.json()) as { ok?: boolean };
    assertCheck(
      healthFinal.status === 200 && healthFinalBody.ok === true,
      'GET /health stays unthrottled (200) after rate-limit exhaustion',
      `status=${healthFinal.status}, body=${JSON.stringify(healthFinalBody)}`,
    );

    log('\n==========================================================');
    log(`SUMMARY: passed=${assertionsPassed}, failed=${failures.length}`);
    log('==========================================================');

    if (failures.length > 0) {
      throw new Error(`${failures.length} assertion(s) failed`);
    }
  } finally {
    log('[TEARDOWN] Stopping API server...');
    await stopServer(server);
    log(`Evidence saved to: ${logFile}`);
  }
}

main().catch((err) => {
  console.error('[MODULE 04 TEST SUITE ERROR]', err);
  process.exit(1);
});
