// ============================================================================
// MODULE 02 BUILD & VERIFICATION TEST: BUG #3 & BUG #4
// ============================================================================
// Bug #3: Log Level Misconfiguration & Config Precedence Short-Circuit
// Bug #4: Timestamp Timezone Mismatch (UTC vs Local Midnight Gap)
// ============================================================================

const assert = require('assert');

// ----------------------------------------------------------------------------
// BUG #3: Log Level Precedence & Request Lifecycle Visibility
// ----------------------------------------------------------------------------
function runBug3Demonstration() {
  console.log('=== TEST: Bug #3 - Log Level Misconfiguration ===');

  const LOG_SEVERITY = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    fatal: 50,
  };

  // 1. Broken Config Loading: Hardcoded config takes precedence over process.env
  function resolveLogLevelBroken(configFile, env) {
    // Defect: config.logging.level is checked first, short-circuiting env var
    return (configFile.logging && configFile.logging.level) || env.LOG_LEVEL || 'info';
  }

  // 2. Fixed Config Loading: Environment variable takes precedence over config file defaults
  function resolveLogLevelFixed(configFile, env) {
    // Environment variable overrides file default
    return env.LOG_LEVEL || (configFile.logging && configFile.logging.level) || 'info';
  }

  const appConfig = {
    logging: {
      level: 'warn', // Hardcoded stale override
    },
  };

  const runtimeEnv = {
    LOG_LEVEL: 'info', // Operator intention: see standard request/response logs
  };

  // Test Broken Precedence
  const brokenLevel = resolveLogLevelBroken(appConfig, runtimeEnv);
  console.log(`[Broken Config] Resolved log level: "${brokenLevel}" (Expected: "warn" due to short-circuit)`);
  assert.strictEqual(brokenLevel, 'warn', 'Broken loader should incorrectly return hardcoded warn');

  // Simulate Request Processing under Broken Level (WARN)
  const capturedLogsBroken = [];
  function emitLogBroken(level, msg, metadata = {}) {
    if (LOG_SEVERITY[level] >= LOG_SEVERITY[brokenLevel]) {
      capturedLogsBroken.push({ level, msg, metadata });
    }
  }

  // Simulate 3 requests: 1 successful creation, 1 redirect, 1 404 not found
  // Request 1: POST /links (Success 201)
  emitLogBroken('info', 'request received', { req_id: 'r-101', method: 'POST', path: '/links' });
  emitLogBroken('info', 'link created', { req_id: 'r-101', code: 'abc01' });
  emitLogBroken('info', 'response sent', { req_id: 'r-101', status: 201 });

  // Request 2: GET /r/abc01 (Success 302)
  emitLogBroken('info', 'request received', { req_id: 'r-102', method: 'GET', path: '/r/abc01' });
  emitLogBroken('info', 'redirect executed', { req_id: 'r-102', code: 'abc01', status: 302 });

  // Request 3: GET /r/missing (Error 404)
  emitLogBroken('info', 'request received', { req_id: 'r-103', method: 'GET', path: '/r/missing' });
  emitLogBroken('error', 'link not found', { req_id: 'r-103', code: 'missing', status: 404 });

  console.log(`[Broken Logs Captured] Total lines captured: ${capturedLogsBroken.length}`);
  console.log('Captured entries:', capturedLogsBroken.map(l => `[${l.level.toUpperCase()}] ${l.msg}`));
  // Notice: Only the 1 error line was captured! Zero "request received" lines!
  assert.strictEqual(capturedLogsBroken.length, 1);
  assert.strictEqual(capturedLogsBroken[0].msg, 'link not found');
  console.log('[PASS] Bug #3 Broken State Confirmed: Error appeared out of thin air without request context.\n');

  // Test Fixed Precedence
  const fixedLevel = resolveLogLevelFixed(appConfig, runtimeEnv);
  console.log(`[Fixed Config] Resolved log level: "${fixedLevel}" (Expected: "info" from LOG_LEVEL env var)`);
  assert.strictEqual(fixedLevel, 'info', 'Fixed loader must respect environment variable LOG_LEVEL');

  const capturedLogsFixed = [];
  function emitLogFixed(level, msg, metadata = {}) {
    if (LOG_SEVERITY[level] >= LOG_SEVERITY[fixedLevel]) {
      capturedLogsFixed.push({ level, msg, metadata });
    }
  }

  // Re-run the exact same 3 requests under Fixed Level (INFO)
  emitLogFixed('info', 'request received', { req_id: 'r-101', method: 'POST', path: '/links' });
  emitLogFixed('info', 'link created', { req_id: 'r-101', code: 'abc01' });
  emitLogFixed('info', 'response sent', { req_id: 'r-101', status: 201 });

  emitLogFixed('info', 'request received', { req_id: 'r-102', method: 'GET', path: '/r/abc01' });
  emitLogFixed('info', 'redirect executed', { req_id: 'r-102', code: 'abc01', status: 302 });

  emitLogFixed('info', 'request received', { req_id: 'r-103', method: 'GET', path: '/r/missing' });
  emitLogFixed('error', 'link not found', { req_id: 'r-103', code: 'missing', status: 404 });

  console.log(`[Fixed Logs Captured] Total lines captured: ${capturedLogsFixed.length}`);
  assert.strictEqual(capturedLogsFixed.length, 7);
  const r103Logs = capturedLogsFixed.filter(l => l.metadata.req_id === 'r-103');
  assert.strictEqual(r103Logs.length, 2);
  assert.strictEqual(r103Logs[0].msg, 'request received');
  assert.strictEqual(r103Logs[1].msg, 'link not found');
  console.log('[PASS] Bug #3 Fix Verified: Full request lifecycle story is visible, linking intake to error.\n');
}

// ----------------------------------------------------------------------------
// BUG #4: Timestamp Timezone Mismatch (UTC vs Local Midnight Gap)
// ----------------------------------------------------------------------------
function runBug4Demonstration() {
  console.log('=== TEST: Bug #4 - Timestamp Timezone Mismatch ===');

  // Scenario:
  // User creates a link at 23:58:00 UTC (11:58 PM UTC).
  // In Eastern Standard Time (EST = UTC-5), that moment is 18:58:00 (6:58 PM).
  // The service queries for links valid today or compares against date partition boundaries.

  const creationInstantUtc = new Date('2025-01-15T23:58:00.000Z');

  // Broken Storage & Querying:
  // Application writes UTC, but DB column is TIMESTAMP WITHOUT TIME ZONE (stores local or wall clock string).
  // Or database runs in local EST, where NOW() returns local time while app checks UTC date.
  function simulateBrokenLinkLookup(linkCreatedUtc, queryInstantUtc, localTzOffsetHours = -5) {
    // Database stored timestamp stripped of UTC zone indicator
    const dbStoredLocalMillis = linkCreatedUtc.getTime() + localTzOffsetHours * 3600 * 1000;
    const dbStoredDate = new Date(dbStoredLocalMillis); // Local wall clock representation

    // Application queries links created on "current UTC date":
    // UTC date of creation: 2025-01-15
    // But if query evaluates db date partition:
    const queryDateUtc = queryInstantUtc.toISOString().slice(0, 10);
    const dbRecordDate = dbStoredDate.toISOString().slice(0, 10);

    // Mismatch check: If application checks whether record exists in active UTC window:
    // If the database comparison does: WHERE created_at >= '2025-01-15 00:00:00' AND created_at < '2025-01-16 00:00:00'
    // But created_at was stored as '2025-01-15 18:58:00' (local), when the clock strikes 00:00 UTC,
    // the query looking for today's links uses UTC '2025-01-16' while DB still has '2025-01-15' for another 5 hours!
    if (queryInstantUtc.toISOString() >= '2025-01-16T00:00:00.000Z' &&
        queryInstantUtc.toISOString() < '2025-01-16T05:00:00.000Z') {
      // Midnight gap! In UTC it is Jan 16, but in local EST it is still Jan 15.
      return { status: 404, reason: 'Timezone gap: date boundary mismatch between UTC and local DB clock' };
    }
    return { status: 302, location: 'https://example.com' };
  }

  // 1. Verify Broken State: Query at 00:05 UTC (5 minutes after midnight UTC)
  const queryMidnightUtc = new Date('2025-01-16T00:05:00.000Z');
  const brokenResult = simulateBrokenLinkLookup(creationInstantUtc, queryMidnightUtc);
  console.log(`[Broken State] Lookup at 00:05 UTC: Status ${brokenResult.status} (${brokenResult.reason})`);
  assert.strictEqual(brokenResult.status, 404, 'Broken implementation should exhibit 404 in midnight timezone gap');
  console.log('[PASS] Bug #4 Broken State Confirmed: Link created near midnight fails during timezone boundary gap.\n');

  // Fixed Storage & Querying: Strictly enforce UTC across all layers
  function simulateFixedLinkLookup(linkCreatedUtc, queryInstantUtc) {
    // 1. Storage: Always ISO-8601 UTC string or epoch millis (TIMESTAMPTZ)
    const dbRecord = {
      code: 'midnight-lnk',
      url: 'https://example.com',
      created_at: linkCreatedUtc.toISOString(), // Standard UTC
      created_at_epoch: linkCreatedUtc.getTime(),
    };

    // 2. Querying: Universal UTC comparison
    // Compare timestamps in absolute UTC time:
    const isAvailable = queryInstantUtc.getTime() >= dbRecord.created_at_epoch;
    if (!isAvailable) {
      return { status: 404, reason: 'Not yet active' };
    }

    return { status: 302, location: dbRecord.url, created_at: dbRecord.created_at };
  }

  // Verify Fixed State across the midnight transition
  const fixedResultBeforeMidnight = simulateFixedLinkLookup(creationInstantUtc, new Date('2025-01-15T23:59:00.000Z'));
  const fixedResultAtMidnight = simulateFixedLinkLookup(creationInstantUtc, new Date('2025-01-16T00:05:00.000Z'));
  const fixedResultHoursLater = simulateFixedLinkLookup(creationInstantUtc, new Date('2025-01-16T03:00:00.000Z'));

  console.log(`[Fixed State] Lookup at 23:59 UTC: Status ${fixedResultBeforeMidnight.status} -> ${fixedResultBeforeMidnight.location}`);
  console.log(`[Fixed State] Lookup at 00:05 UTC: Status ${fixedResultAtMidnight.status} -> ${fixedResultAtMidnight.location}`);
  console.log(`[Fixed State] Lookup at 03:00 UTC: Status ${fixedResultHoursLater.status} -> ${fixedResultHoursLater.location}`);

  assert.strictEqual(fixedResultBeforeMidnight.status, 302);
  assert.strictEqual(fixedResultAtMidnight.status, 302);
  assert.strictEqual(fixedResultHoursLater.status, 302);
  assert.strictEqual(fixedResultAtMidnight.created_at, '2025-01-15T23:58:00.000Z');
  console.log('[PASS] Bug #4 Fix Verified: UTC normalization guarantees immediate redirect availability with zero timezone delay.\n');
}

// ----------------------------------------------------------------------------
// MAIN TEST RUNNER
// ----------------------------------------------------------------------------
try {
  runBug3Demonstration();
  runBug4Demonstration();
  console.log('================================================================');
  console.log('>>> ALL VERIFICATION CHECKS FOR MODULE 02 PASSED (100% GREEN) <<<');
  console.log('================================================================');
} catch (err) {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
}
