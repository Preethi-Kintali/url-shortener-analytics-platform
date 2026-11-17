import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { redactSensitiveText, sanitizeValue } from '../src/common/logging/redaction.util';
import { StructuredLoggerService } from '../src/common/logging/structured-logger.service';
import { isValidRequestId } from '../src/common/middleware/request-id.util';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-05');
fs.mkdirSync(evidenceDir, { recursive: true });
const logFile = path.join(evidenceDir, 'error-logging-tests.txt');
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

interface SpawnedServer {
  process: ChildProcess;
  stdoutLines: string[];
  stderrLines: string[];
  allOutput: () => string;
}

async function startApiServer(envOverrides?: Record<string, string>, port = 3000): Promise<SpawnedServer> {
  const apiDir = path.resolve(__dirname, '..');
  const serverScript = path.join(apiDir, 'dist', 'main.js');
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const proc = spawn('node', [serverScript], {
    cwd: apiDir,
    stdio: 'pipe',
    shell: false,
    env: {
      ...process.env,
      PORT: String(port),
      ...envOverrides,
    },
  });

  let stdoutBuf = '';
  proc.stdout?.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    const parts = stdoutBuf.split(/\r?\n/);
    stdoutBuf = parts.pop() || '';
    stdoutLines.push(...parts.filter((l) => l.length > 0));
  });

  let stderrBuf = '';
  proc.stderr?.on('data', (chunk) => {
    stderrBuf += chunk.toString('utf8');
    const parts = stderrBuf.split(/\r?\n/);
    stderrBuf = parts.pop() || '';
    stderrLines.push(...parts.filter((l) => l.length > 0));
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
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
    await stopServer(proc);
    throw new Error(`Server failed to become healthy on port ${port}`);
  }

  return {
    process: proc,
    stdoutLines,
    stderrLines,
    allOutput: () => [...stdoutLines, stdoutBuf, ...stderrLines, stderrBuf].filter(Boolean).join('\n'),
  };
}

function parseJsonLogLines(rawOutput: string): Array<Record<string, unknown>> {
  const parsed: Array<Record<string, unknown>> = [];
  for (const line of rawOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      parsed.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // Non-JSON output
    }
  }
  return parsed;
}

function assertSafeErrorEnvelope(
  bodyText: string,
  expectedCode: string,
  headerRequestId: string | null,
  label: string,
): Record<string, unknown> | null {
  let parsed: { error?: { code?: string; message?: string; request_id?: string } } | null = null;
  try {
    parsed = JSON.parse(bodyText) as { error?: { code?: string; message?: string; request_id?: string } };
  } catch {
    assertCheck(false, `${label} returns valid JSON`, `body=${bodyText}`);
    return null;
  }

  const errObj = parsed?.error;
  const hasEnvelope =
    Boolean(errObj) &&
    typeof errObj?.code === 'string' &&
    errObj.code === expectedCode &&
    typeof errObj?.message === 'string' &&
    errObj.message.length > 0 &&
    typeof errObj?.request_id === 'string' &&
    errObj.request_id.length >= 8;

  const noLeaks =
    !bodyText.includes('stack') &&
    !/\bat\s+[A-Za-z0-9_<$.]+\s+\(/.test(bodyText) &&
    !bodyText.includes('at position') &&
    !bodyText.includes('D:\\') &&
    !bodyText.includes('postgresql://') &&
    !bodyText.includes('postgres://') &&
    !bodyText.includes('SELECT ') &&
    !bodyText.includes('Prisma');

  const headerMatches = headerRequestId !== null && errObj?.request_id === headerRequestId;

  assertCheck(
    hasEnvelope && noLeaks && headerMatches,
    label,
    `code=${errObj?.code}, request_id=${errObj?.request_id}, header=${headerRequestId}, noLeaks=${noLeaks}`,
  );
  return (errObj as Record<string, unknown>) || null;
}

async function main(): Promise<void> {
  log('====================================================================');
  log('Module 05: Error Handling, Request ID & Redaction Verification Suite');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('====================================================================\n');

  // UNIT VERIFICATION OF EXCEPTION MAPPING & LOG INJECTION / REDACTION HELPERS
  log('--- SECTION 0: Exception Filter Mapping & Redaction Unit Checks ---');
  const unitLogger = new StructuredLoggerService();
  const filter = new AllExceptionsFilter(unitLogger);

  const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
  });
  const mappedP2002 = filter.mapException(p2002);
  assertCheck(
    mappedP2002.statusCode === 409 && mappedP2002.code === 'CONFLICT',
    'Prisma P2002 maps to HTTP 409 CONFLICT',
    `status=${mappedP2002.statusCode}, code=${mappedP2002.code}`,
  );

  const p1001 = new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
    code: 'P1001',
    clientVersion: '6.19.3',
  });
  const mappedP1001 = filter.mapException(p1001);
  assertCheck(
    mappedP1001.statusCode === 503 && mappedP1001.code === 'DATABASE_UNAVAILABLE',
    'Prisma P1001 maps to HTTP 503 DATABASE_UNAVAILABLE',
    `status=${mappedP1001.statusCode}, code=${mappedP1001.code}`,
  );

  const unhandled = new Error('Crash with postgresql://u:supersecret@db:5432/prod and Bearer abc.def.ghi');
  const mappedUnhandled = filter.mapException(unhandled);
  const redactedDetail = redactSensitiveText(mappedUnhandled.internalDetail || '');
  assertCheck(
    mappedUnhandled.statusCode === 500 &&
      mappedUnhandled.code === 'INTERNAL_ERROR' &&
      mappedUnhandled.message === 'Internal server error' &&
      !redactedDetail.includes('supersecret') &&
      !redactedDetail.includes('abc.def.ghi'),
    'Unhandled Error maps to safe HTTP 500 and redacts embedded credentials',
    `status=${mappedUnhandled.statusCode}, safeMessage=${mappedUnhandled.message}, redacted=${redactedDetail}`,
  );

  assertCheck(
    isValidRequestId('req_valid-id.01') &&
      !isValidRequestId('short') &&
      !isValidRequestId('bad\ninjected') &&
      !isValidRequestId('bad;space value'),
    'X-Request-Id validator accepts safe IDs and rejects short/control/log-injection values',
  );

  const piiTextRedacted = redactSensitiveText(
    'Failed login actor_email=jane.doe@example.com from 203.0.113.42 for bob.smith@corp.test',
  );
  const piiObjRedacted = JSON.stringify(
    sanitizeValue({ actor_email: 'jane.doe@example.com', client_ip: '203.0.113.42', safe: 'ok' }),
  );
  assertCheck(
    !piiTextRedacted.includes('jane.doe@example.com') &&
      !piiTextRedacted.includes('bob.smith@corp.test') &&
      !piiTextRedacted.includes('203.0.113.42') &&
      !piiObjRedacted.includes('jane.doe@example.com') &&
      !piiObjRedacted.includes('203.0.113.42'),
    'Redaction utility scrubs email addresses, IPv4 addresses, and PII object keys',
    `text=${piiTextRedacted}`,
  );
  log('');

  // LIVE SERVER #1: NORMAL WORKING DB (PORT 3000)
  log('--- SECTION A/C/D: Validation Envelope, Request ID, Redaction & Normal Operations ---');
  const normalServer = await startApiServer({}, 3000);
  const normalBase = 'http://127.0.0.1:3000';
  let createdLinkId: string | null = null;
  let aliceToken = '';

  try {
    // Login as Alice
    const loginRes = await fetch(`${normalBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'dev-alice-secret-01' }),
    });
    const loginBody = (await loginRes.json()) as { access_token: string };
    aliceToken = loginBody.access_token;
    assertCheck(loginRes.status === 200 && typeof aliceToken === 'string', 'Authenticated login succeeds (200)');

    // A1: Validation error with invalid long_url
    const invalidUrlRes = await fetch(`${normalBase}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ long_url: 'not-a-url' }),
    });
    const invalidUrlText = await invalidUrlRes.text();
    const invalidUrlHeaderId = invalidUrlRes.headers.get('x-request-id');
    assertCheck(invalidUrlRes.status === 400, 'Authenticated POST /links with invalid long_url returns HTTP 400');
    assertSafeErrorEnvelope(
      invalidUrlText,
      'VALIDATION_ERROR',
      invalidUrlHeaderId,
      'Validation error returns standardized envelope with matching X-Request-Id and no leaks',
    );
    log(`   Sample 400 envelope: ${invalidUrlText}`);

    // A2: Malformed JSON body -> 400 INVALID_JSON with request_id
    const malformedJsonRes = await fetch(`${normalBase}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: '{"long_url": "https://example.com"',
    });
    const malformedJsonText = await malformedJsonRes.text();
    assertCheck(malformedJsonRes.status === 400, 'Malformed JSON body returns HTTP 400');
    assertSafeErrorEnvelope(
      malformedJsonText,
      'INVALID_JSON',
      malformedJsonRes.headers.get('x-request-id'),
      'Malformed JSON returns standardized INVALID_JSON envelope with request_id',
    );
    log(`   Sample malformed JSON envelope: ${malformedJsonText}`);

    // A3: Incoming valid X-Request-Id honored vs invalid X-Request-Id rejected
    const customValidReqId = 'client-trace-m5-01';
    const validReqIdRes = await fetch(`${normalBase}/links/nonexistent-id-05`, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Request-Id': customValidReqId,
      },
    });
    const validReqIdText = await validReqIdRes.text();
    const validReqIdParsed = JSON.parse(validReqIdText) as { error?: { request_id?: string } };
    assertCheck(
      validReqIdRes.status === 404 &&
        validReqIdRes.headers.get('x-request-id') === customValidReqId &&
        validReqIdParsed.error?.request_id === customValidReqId,
      'Valid incoming X-Request-Id is honored across header and error envelope (404)',
      `body=${validReqIdText}`,
    );

    const unsafeReqId = 'bad;id=1';
    const invalidReqIdRes = await fetch(`${normalBase}/links/nonexistent-id-05`, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Request-Id': unsafeReqId,
      },
    });
    const generatedFallbackId = invalidReqIdRes.headers.get('x-request-id') || '';
    const invalidReqIdBody = (await invalidReqIdRes.json()) as { error?: { request_id?: string } };
    assertCheck(
      invalidReqIdRes.status === 404 &&
        generatedFallbackId !== unsafeReqId &&
        /^req_[0-9a-f]{24}$/.test(generatedFallbackId) &&
        invalidReqIdBody.error?.request_id === generatedFallbackId,
      'Invalid incoming X-Request-Id is rejected and replaced with secure generated ID',
      `generated=${generatedFallbackId}`,
    );

    // C: Secret Redaction Sentinel Checks
    const sentinelToken = 'DO_NOT_LOG_ME_123';
    const sentinelPass = 'DO_NOT_LOG_ME_PASS_456';
    const sentinelReqId = 'sentinel-redaction-01';

    const sentinelAuthRes = await fetch(`${normalBase}/links`, {
      headers: {
        Authorization: `Bearer ${sentinelToken}`,
        'X-Request-Id': sentinelReqId,
      },
    });
    const sentinelAuthText = await sentinelAuthRes.text();
    assertCheck(sentinelAuthRes.status === 401, 'Sentinel Bearer DO_NOT_LOG_ME_123 rejected with HTTP 401');
    assertSafeErrorEnvelope(
      sentinelAuthText,
      'UNAUTHORIZED',
      sentinelAuthRes.headers.get('x-request-id'),
      'Sentinel 401 returns standardized UNAUTHORIZED envelope',
    );
    log(`   Sample 401 envelope: ${sentinelAuthText}`);

    const sentinelLoginRes = await fetch(`${normalBase}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': 'pii-fix-regression-01',
        'X-Forwarded-For': '203.0.113.42',
      },
      body: JSON.stringify({ email: 'jane.doe@example.com', password: sentinelPass }),
    });
    const sentinelLoginText = await sentinelLoginRes.text();
    assertCheck(sentinelLoginRes.status === 401, 'Wrong login password rejected with HTTP 401');
    assertSafeErrorEnvelope(
      sentinelLoginText,
      'UNAUTHORIZED',
      sentinelLoginRes.headers.get('x-request-id'),
      'Failed login 401 returns safe UNAUTHORIZED envelope with matching X-Request-Id and zero PII',
    );

    // Quick CRUD + redirect regression under new middleware & filter
    const createOkRes = await fetch(`${normalBase}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ long_url: 'https://example.com/module-05-verified' }),
    });
    const createdOk = (await createOkRes.json()) as { id: string; code: string };
    createdLinkId = createdOk.id;
    const redirRes = await fetch(`${normalBase}/r/${createdOk.code}`, { redirect: 'manual' });
    const healthRes = await fetch(`${normalBase}/health`);
    assertCheck(
      createOkRes.status === 201 &&
        redirRes.status === 302 &&
        redirRes.headers.get('location') === 'https://example.com/module-05-verified' &&
        healthRes.status === 200,
      'Normal create (201), public redirect (302), and /health (200) work cleanly with Module 05 middleware',
    );

    if (createdLinkId) {
      await fetch(`${normalBase}/links/${createdLinkId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
    }

    // Wait briefly so finish log listeners flush
    await sleep(200);
  } finally {
    await stopServer(normalServer.process);
  }

  // Inspect normalServer logs for structured fields, matching request_id, and ZERO secrets
  const normalRawLogs = normalServer.allOutput();
  const normalJsonLogs = parseJsonLogLines(normalRawLogs);
  const sentinelMissingFromLogs =
    !normalRawLogs.includes('DO_NOT_LOG_ME_123') &&
    !normalRawLogs.includes('DO_NOT_LOG_ME_PASS_456') &&
    !normalRawLogs.includes('dev-alice-secret-01') &&
    !normalRawLogs.includes('jane.doe@example.com') &&
    !normalRawLogs.includes('203.0.113.42') &&
    !normalRawLogs.includes('actor_email=') &&
    (aliceToken.length === 0 || !normalRawLogs.includes(aliceToken));

  const sentinelLogs = normalJsonLogs.filter((entry) => entry.request_id === 'sentinel-redaction-01');
  const piiRegressionLogs = normalJsonLogs.filter(
    (entry) => entry.request_id === 'pii-fix-regression-01',
  );
  assertCheck(
    sentinelMissingFromLogs && sentinelLogs.length >= 1 && piiRegressionLogs.length >= 1,
    'Secret and PII redaction confirmed: DO_NOT_LOG_ME_123, passwords, JWTs, emails, and client IPs absent from all server logs',
    `sentinel_logs=${JSON.stringify(sentinelLogs)}, pii_fix_logs=${JSON.stringify(piiRegressionLogs)}`,
  );

  const sampleCustomErrLog = normalJsonLogs.find(
    (entry) => entry.event === 'http_request' && entry.request_id === 'client-trace-m5-01',
  );
  assertCheck(
    Boolean(sampleCustomErrLog) &&
      sampleCustomErrLog?.route === '/links/nonexistent-id-05' &&
      sampleCustomErrLog?.status_code === 404 &&
      typeof sampleCustomErrLog?.latency_ms === 'number',
    'Structured HTTP log records request_id, route, status_code, and latency_ms',
    `entry=${JSON.stringify(sampleCustomErrLog)}`,
  );
  log('');

  // LIVE SERVER #2: ISOLATED INVALID DATABASE_URL (PORT 3105)
  log('--- SECTION B: Isolated Invalid DATABASE_URL Server Error Test (Port 3105) ---');
  const badDbSecret = 'SECRET_DB_PASS_999';
  const badDbUrl = `postgresql://bad_db_user:${badDbSecret}@127.0.0.1:59999/nonexistent_db`;

  const brokenDbServer = await startApiServer({ DATABASE_URL: badDbUrl }, 3105);
  const brokenBase = 'http://127.0.0.1:3105';
  let dbErrRequestId = '';
  let dbErrResponseText = '';

  try {
    const degradedHealth = await fetch(`${brokenBase}/health`);
    assertCheck(degradedHealth.status === 200, 'Isolated server /health responds 200 even when DB is unreachable');

    // Trigger DB-dependent request (public redirect lookup hits Prisma)
    const dbFailRedir = await fetch(`${brokenBase}/r/anycode05`, { redirect: 'manual' });
    dbErrResponseText = await dbFailRedir.text();
    const dbFailHeaderId = dbFailRedir.headers.get('x-request-id');

    assertCheck(
      dbFailRedir.status === 503,
      'DB-dependent GET /r/:code returns controlled HTTP 503 when DATABASE_URL is invalid',
      `status=${dbFailRedir.status}`,
    );
    const dbErrObj = assertSafeErrorEnvelope(
      dbErrResponseText,
      'DATABASE_UNAVAILABLE',
      dbFailHeaderId,
      'HTTP 503 returns standardized DATABASE_UNAVAILABLE envelope with matching X-Request-Id and zero leaks',
    );
    dbErrRequestId = typeof dbErrObj?.request_id === 'string' ? dbErrObj.request_id : '';
    log(`   Sample 503 envelope: ${dbErrResponseText}`);

    // Also test DB-dependent authenticated GET /links on isolated broken-DB server
    const brokenLogin = await fetch(`${brokenBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'dev-alice-secret-01' }),
    });
    const brokenLoginBody = (await brokenLogin.json()) as { access_token: string };
    const dbFailLinks = await fetch(`${brokenBase}/links`, {
      headers: { Authorization: `Bearer ${brokenLoginBody.access_token}` },
    });
    const dbFailLinksText = await dbFailLinks.text();
    assertCheck(
      dbFailLinks.status === 503,
      'Authenticated GET /links returns controlled HTTP 503 when DATABASE_URL is invalid',
      `status=${dbFailLinks.status}`,
    );
    assertSafeErrorEnvelope(
      dbFailLinksText,
      'DATABASE_UNAVAILABLE',
      dbFailLinks.headers.get('x-request-id'),
      'Authenticated DB 503 response matches envelope and leaks no DB URL or stack',
    );

    await sleep(200);
  } finally {
    await stopServer(brokenDbServer.process);
  }

  const brokenRawLogs = brokenDbServer.allOutput();
  const brokenJsonLogs = parseJsonLogLines(brokenRawLogs);
  const matchingServer503Log = brokenJsonLogs.find(
    (entry) =>
      entry.event === 'http_request' &&
      entry.request_id === dbErrRequestId &&
      entry.status_code === 503,
  );
  const matchingError503Log = brokenJsonLogs.find(
    (entry) =>
      entry.event === 'request_error' &&
      entry.request_id === dbErrRequestId &&
      entry.status_code === 503,
  );

  const dbSecretMissingFromAll =
    !brokenRawLogs.includes(badDbSecret) &&
    !brokenRawLogs.includes('bad_db_user') &&
    !dbErrResponseText.includes(badDbSecret) &&
    !dbErrResponseText.includes('bad_db_user') &&
    !dbErrResponseText.includes('59999');

  assertCheck(
    Boolean(matchingServer503Log) && Boolean(matchingError503Log),
    'Broken-DB server logs contain request_error and http_request entries with exact matching request_id',
    `request_id=${dbErrRequestId}, http_log=${JSON.stringify(matchingServer503Log)}`,
  );
  assertCheck(
    dbSecretMissingFromAll,
    'Database connection string & credentials never exposed in HTTP 503 responses or server logs',
  );

  log('\n====================================================================');
  log(`SUMMARY: passed=${assertionsPassed}, failed=${failures.length}`);
  log('====================================================================');

  if (failures.length > 0) {
    throw new Error(`${failures.length} assertion(s) failed`);
  }
}

main().catch((err) => {
  console.error('[MODULE 05 TEST SUITE ERROR]', err);
  process.exit(1);
});
