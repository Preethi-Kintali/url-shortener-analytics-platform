// ============================================================================
// MODULE 03 BREAK: Silent Data Corruption Reproduction (Timestamp Inversion Race)
// ============================================================================
// Demonstrates how naive atomic upsert produces correct counts but silently
// corrupts timestamps due to Last-Writer-Wins (LWW) execution reordering.
// ============================================================================

const assert = require('assert');

class MockAnalyticsStore {
  constructor() {
    this.table = new Map(); // key -> { link_id, bucket, count, last_accessed_at }
  }

  reset() {
    this.table.clear();
  }

  // Naive Upsert: count is atomic, but last_accessed_at unconditionally overwrites
  async naiveUpsert(linkId, bucket, requestTimestamp, simulatedJitterMs) {
    const key = `${linkId}:${bucket}`;

    // Simulate async execution jitter (connection checkout / thread scheduling)
    await new Promise((resolve) => setTimeout(resolve, simulatedJitterMs));

    // Database atomic upsert execution
    const row = this.table.get(key);
    if (!row) {
      this.table.set(key, {
        link_id: linkId,
        bucket,
        count: 1,
        last_accessed_at: requestTimestamp,
      });
    } else {
      row.count += 1;
      // VULNERABLE ASSIGNMENT: Unconditional overwrite (Last-Writer-Wins)
      row.last_accessed_at = requestTimestamp;
    }
    return { ...this.table.get(key) };
  }

  // Fixed Monotonic Upsert: last_accessed_at uses GREATEST()
  async monotonicUpsert(linkId, bucket, requestTimestamp, simulatedJitterMs) {
    const key = `${linkId}:${bucket}`;

    // Simulate async execution jitter
    await new Promise((resolve) => setTimeout(resolve, simulatedJitterMs));

    // Database atomic upsert execution with GREATEST semantics
    const row = this.table.get(key);
    if (!row) {
      this.table.set(key, {
        link_id: linkId,
        bucket,
        count: 1,
        last_accessed_at: requestTimestamp,
      });
    } else {
      row.count += 1;
      // MONOTONIC ASSIGNMENT: GREATEST(existing, incoming)
      if (requestTimestamp > row.last_accessed_at) {
        row.last_accessed_at = requestTimestamp;
      }
    }
    return { ...this.table.get(key) };
  }
}

async function runSilentCorruptionReproduction() {
  console.log('=== PHASE 1: Reproducing Silent Data Corruption (Timestamp Inversion) ===');
  const store = new MockAnalyticsStore();
  const linkId = 42;
  const bucket = '2025-01-15T14:00:00Z';
  const BASE_TIME = 1736950800000; // 14:00:00.000 UTC

  // 10 concurrent requests arrive at exact 1ms intervals
  // Req 0 arrives at +0ms, Req 9 arrives at +9ms (the true latest request)
  // We simulate execution jitter: Req 9 executes quickly (1ms), Req 2 executes slowly (15ms)
  const requests = Array.from({ length: 10 }, (_, i) => ({
    id: i,
    arrivedAt: BASE_TIME + i * 2, // Arrival: 0ms, 2ms, 4ms, 6ms, ..., 18ms
    // Deliberate execution delay: earlier requests take longer, finishing last in DB
    jitterMs: (10 - i) * 3, // Req 0 delays 30ms, Req 9 delays 3ms
  }));

  const trueLatestRequest = requests[requests.length - 1];
  console.log(`True latest request arriving at server: Req #${trueLatestRequest.id} at ${new Date(trueLatestRequest.arrivedAt).toISOString()}`);

  // Fire all 10 requests concurrently
  const promises = requests.map((req) =>
    store.naiveUpsert(linkId, bucket, req.arrivedAt, req.jitterMs)
  );

  await Promise.all(promises);

  const finalRow = store.table.get(`${linkId}:${bucket}`);
  console.log('\nFinal Database State under Naive Upsert:');
  console.log(`- Final Count: ${finalRow.count} (Expected: 10) -> [OK]`);
  console.log(`- Final last_accessed_at: ${new Date(finalRow.last_accessed_at).toISOString()}`);
  console.log(`- Expected last_accessed_at: ${new Date(trueLatestRequest.arrivedAt).toISOString()}`);

  const timestampSkew = trueLatestRequest.arrivedAt - finalRow.last_accessed_at;
  console.log(`- Timestamp Inversion Skew: -${timestampSkew}ms behind actual last request!`);

  assert.strictEqual(finalRow.count, 10, 'Count should correctly reflect all 10 requests');
  assert.notStrictEqual(
    finalRow.last_accessed_at,
    trueLatestRequest.arrivedAt,
    'Vulnerability confirmed: database timestamp does not match last arrival timestamp'
  );
  console.log('\n[CONFIRMED] Silent data corruption reproduced: count is correct, but timestamp was overwritten by an earlier request!');
}

async function runMonotonicFixVerification() {
  console.log('\n=== PHASE 2: Verifying Monotonic Upsert Fix (GREATEST Timestamp Invariant) ===');
  const store = new MockAnalyticsStore();
  const linkId = 42;
  const bucket = '2025-01-15T14:00:00Z';
  const BASE_TIME = 1736950800000;

  const requests = Array.from({ length: 10 }, (_, i) => ({
    id: i,
    arrivedAt: BASE_TIME + i * 2,
    jitterMs: (10 - i) * 3,
  }));

  const trueLatestRequest = requests[requests.length - 1];

  const promises = requests.map((req) =>
    store.monotonicUpsert(linkId, bucket, req.arrivedAt, req.jitterMs)
  );

  await Promise.all(promises);

  const finalRow = store.table.get(`${linkId}:${bucket}`);
  console.log('Final Database State under Monotonic Upsert:');
  console.log(`- Final Count: ${finalRow.count} (Expected: 10) -> [OK]`);
  console.log(`- Final last_accessed_at: ${new Date(finalRow.last_accessed_at).toISOString()}`);
  console.log(`- Expected last_accessed_at: ${new Date(trueLatestRequest.arrivedAt).toISOString()}`);

  assert.strictEqual(finalRow.count, 10, 'Count must equal 10');
  assert.strictEqual(
    finalRow.last_accessed_at,
    trueLatestRequest.arrivedAt,
    'Monotonic fix verified: timestamp matches the true latest request'
  );
  console.log('\n[PASS] Monotonic timestamp fix verified: out-of-order writes can never roll back last_accessed_at.');
}

async function main() {
  await runSilentCorruptionReproduction();
  await runMonotonicFixVerification();
  console.log('\n============================================================');
  console.log('>>> MODULE 03 BREAK TEST PASSED (CORRUPTION + FIX VERIFIED) <<<');
  console.log('============================================================');
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
