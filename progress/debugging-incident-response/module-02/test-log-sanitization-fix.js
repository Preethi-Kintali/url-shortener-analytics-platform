// ============================================================================
// MODULE 02 FIX VERIFICATION: Log Injection / CRLF Sanitization
// ============================================================================

const assert = require('assert');

// 1. Sanitization Utility: Replaces control characters (\n, \r, etc.) with spaces or escapes
function sanitizeLogField(input) {
  if (typeof input !== 'string') return input;
  // Replace carriage return and newline control characters with escaped representation or space
  return input.replace(/[\r\n]+/g, ' ');
}

// 2. Safe Structured Logger: Enforces JSON encoding and control character sanitization
function createSafeLogEntry(level, msg, metadata = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
  };

  for (const [key, val] of Object.entries(metadata)) {
    if (typeof val === 'string') {
      entry[key] = sanitizeLogField(val);
    } else {
      entry[key] = val;
    }
  }

  // JSON.stringify guarantees proper escaping of string values (e.g. quotes, backslashes)
  return JSON.stringify(entry);
}

function testLogInjectionRemediation() {
  console.log('=== FIX VERIFICATION: Log Injection / CRLF Sanitization ===');

  const maliciousUrl = 'https://normal-url.com\n{"ts":"2025-01-15T15:42:03.500Z","level":"info","req_id":"r-102","msg":"admin login successful","user":"admin","ip":"10.0.0.1"}';

  // 1. Generate Safe Log Output
  const safeLogLine = createSafeLogEntry('info', 'link created', {
    req_id: 'r-101',
    short_code: 'qR2wX',
    url: maliciousUrl,
  });

  console.log('[SAFE LOG LINE GENERATED]:');
  console.log(safeLogLine);

  // 2. Verify Line-Based Aggregator Ingestion
  const lines = safeLogLine.split('\n');
  console.log(`\n[LOG AGGREGATOR INGESTION]: Number of lines emitted: ${lines.length}`);
  assert.strictEqual(lines.length, 1, 'Safe log output MUST produce exactly 1 line with zero line breaks');

  // 3. Parse JSON Entry
  const parsed = JSON.parse(safeLogLine);
  console.log('[PARSED LOG OBJECT]:', {
    ts: parsed.ts,
    level: parsed.level,
    msg: parsed.msg,
    req_id: parsed.req_id,
    url: parsed.url.slice(0, 60) + '...',
  });

  // Verify properties
  assert.strictEqual(parsed.req_id, 'r-101', 'Log must retain legitimate caller request ID');
  assert.strictEqual(parsed.msg, 'link created', 'Log message must not be spoofed');
  assert(!parsed.url.includes('\n'), 'Sanitized URL must not contain unescaped newline');
  assert(!parsed.url.includes('\r'), 'Sanitized URL must not contain carriage return');

  // Verify that fake event cannot be interpreted as a top-level log entry
  assert.strictEqual(parsed.user, undefined, 'Spoofed user attribute must not leak into top-level log object');
  assert.strictEqual(parsed.ip, undefined, 'Spoofed IP attribute must not leak into top-level log object');

  console.log('\n>>> VERIFICATION SUCCESS: Malicious URL is cleanly encapsulated as string data; zero log forgery detected.');
}

try {
  testLogInjectionRemediation();
} catch (err) {
  console.error('Test failed:', err);
  process.exit(1);
}
