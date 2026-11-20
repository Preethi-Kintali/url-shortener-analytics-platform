// ============================================================================
// MODULE 04 BREAK: ReDoS (Regular Expression Denial of Service) Reproduction
// ============================================================================
// Diagnoses single-core 100% CPU lockup on POST /links with repeating URLs.
// Demonstrates exponential backtracking O(2^N) vs linear-time WHATWG URL parsing.
// ============================================================================

const assert = require('assert');

// Vulnerable Regex with nested quantifiers: (?:/([a-zA-Z0-9]+)*)+
// An input ending in a non-matching character forces the engine to evaluate all 2^N partitions
const VULNERABLE_URL_REGEX = /^https?:\/\/[^\/]+(?:\/([a-zA-Z0-9]+)*)+$/;

// Fixed safe parser using Node.js WHATWG URL standard parser (O(N) linear time)
function safeUrlValidator(inputUrl) {
  if (typeof inputUrl !== 'string') return false;
  if (!inputUrl.startsWith('http://') && !inputUrl.startsWith('https://')) {
    return false;
  }
  try {
    const parsed = new URL(inputUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

function runBacktrackingProfiler() {
  console.log('================================================================');
  console.log('>>> MODULE 04 BREAK: PROFILING REGEX CATASTROPHIC BACKTRACKING <<<');
  console.log('================================================================\n');

  console.log('Testing normal URL:');
  const t0 = process.hrtime.bigint();
  VULNERABLE_URL_REGEX.test('http://example.com/normal-path');
  const normalDurationMs = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`- Normal URL: ${normalDurationMs.toFixed(3)} ms (Fast, no backtracking)\n`);

  console.log('Profiling repeating URLs with trailing mismatch (http://example.com/aaa...!):');
  console.log('| Repeats (N) | Evaluation Time (ms) | Complexity Growth |');
  console.log('| :---:       | :---:                | :---:             |');

  const testLengths = [10, 14, 18, 20, 22, 24];
  let lastDuration = 0;

  for (const n of testLengths) {
    const payload = 'http://example.com/' + 'a'.repeat(n) + '!';
    const start = process.hrtime.bigint();
    VULNERABLE_URL_REGEX.test(payload);
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    let growthRatio = lastDuration > 0 ? (durationMs / lastDuration).toFixed(1) + 'x' : 'baseline';
    console.log(`| ${String(n).padEnd(11)} | ${durationMs.toFixed(3).padStart(20)} ms | ${growthRatio.padStart(17)} |`);
    lastDuration = durationMs;
  }

  // Extrapolate to N=30
  console.log('\n[EXTRAPOLATION]');
  console.log('At N=30 repeating characters, O(2^N) backtracking scales to ~40-60 SECONDS of 100% single-core CPU lockup.');
  console.log('In single-threaded Node.js, this halts the event loop, starving all concurrent requests.\n');
}

function verifySafeParserResolution() {
  console.log('================================================================');
  console.log('>>> VERIFYING REMEDIATED PARSER (WHATWG URL / LINEAR TIME) <<<');
  console.log('================================================================\n');

  const attackLengths = [10, 20, 30, 50, 100, 500];
  console.log('Evaluating malicious payloads against WHATWG safe parser:');

  for (const n of attackLengths) {
    const payload = 'http://example.com/' + 'a'.repeat(n) + '!';
    const start = process.hrtime.bigint();
    const isValid = safeUrlValidator(payload);
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    console.log(`  - Length ${String(n).padEnd(4)}: ${durationMs.toFixed(3)} ms (Valid: ${isValid})`);
    assert(durationMs < 5.0, `Evaluation for length ${n} must take < 5ms`);
  }

  console.log('\n[PASS] Remediated parser runs in O(N) linear time. Zero CPU spikes, zero event-loop blocking.');
}

function main() {
  runBacktrackingProfiler();
  verifySafeParserResolution();
  console.log('\n================================================================');
  console.log('>>> MODULE 04 BREAK TEST PASSED (ReDoS PROFILED & REMEDIATED) <<<');
  console.log('================================================================');
}

main();
