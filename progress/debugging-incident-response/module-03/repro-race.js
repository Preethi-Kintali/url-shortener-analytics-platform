// ============================================================================
// MODULE 03 BUILD: Minimal Synthetic Concurrency Reproduction (Bug #5)
// ============================================================================
// Bug #5: Analytics Unique Constraint Violation under Concurrent Redirects
// Demonstrates check-then-act race condition vs atomic upsert resolution
// ============================================================================

const assert = require('assert');

// In-memory mock database simulating PostgreSQL unique constraint on (link_id, timestamp_bucket)
class MockDatabase {
  constructor() {
    this.table = new Map(); // key: `${link_id}:${bucket}` -> { link_id, bucket, count }
    this.uniqueConstraint = 'analytics_link_id_bucket_unique';
  }

  reset() {
    this.table.clear();
  }

  // Vulnerable Check-Then-Act implementation
  async checkThenActIncrement(linkId, bucket) {
    const key = `${linkId}:${bucket}`;

    // Step 1: Check (SELECT)
    const existing = this.table.get(key);

    // Simulate non-zero asynchronous I/O window (context switch / network latency)
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));

    // Step 2: Act (INSERT or UPDATE)
    if (!existing) {
      // Re-check simulated database engine constraint boundary:
      if (this.table.has(key)) {
        const err = new Error(`duplicate key value violates unique constraint "${this.uniqueConstraint}"`);
        err.code = '23505';
        err.detail = `Key (link_id, timestamp_bucket)=(${linkId}, ${bucket}) already exists.`;
        throw err;
      }
      this.table.set(key, { link_id: linkId, bucket, count: 1 });
      return { action: 'inserted', count: 1 };
    } else {
      existing.count += 1;
      return { action: 'updated', count: existing.count };
    }
  }

  // Fixed Atomic Upsert implementation (PostgreSQL INSERT ... ON CONFLICT DO UPDATE)
  async atomicUpsertIncrement(linkId, bucket) {
    const key = `${linkId}:${bucket}`;

    // Database internal serialization turnstile (atomic row lock):
    const row = this.table.get(key);
    if (!row) {
      this.table.set(key, { link_id: linkId, bucket, count: 1 });
      return { action: 'upserted_new', count: 1 };
    } else {
      row.count += 1;
      return { action: 'upserted_increment', count: row.count };
    }
  }
}

async function runRaceConditionReproduction() {
  console.log('=== PHASE 1: Reproducing Check-Then-Act Race Condition (Bug #5) ===');
  const db = new MockDatabase();
  const CONCURRENCY = 10;
  const linkId = 42;
  const bucket = '2025-01-15T14:00:00Z';

  // Fire 10 concurrent requests simultaneously using Promise.all
  const promises = Array.from({ length: CONCURRENCY }, async (_, idx) => {
    try {
      await db.checkThenActIncrement(linkId, bucket);
      return { status: 302, req: idx };
    } catch (err) {
      return { status: 500, error: err.message, code: err.code };
    }
  });

  const results = await Promise.all(promises);
  const successes = results.filter((r) => r.status === 302);
  const errors = results.filter((r) => r.status === 500);

  console.log(`Results: ${successes.length} redirects, ${errors.length} errors (HTTP 500)`);
  if (errors.length > 0) {
    console.log(`[PASS] BUG REPRODUCED: ${errors[0].error}`);
  }
  assert(errors.length > 0, 'Expected check-then-act to trigger unique constraint violation under concurrency');
}

async function runAtomicUpsertVerification() {
  console.log('\n=== PHASE 2: Verifying Atomic Upsert Fix (ON CONFLICT DO UPDATE) ===');
  const db = new MockDatabase();
  const CONCURRENCY = 10;
  const linkId = 42;
  const bucket = '2025-01-15T14:00:00Z';

  // Run 10 consecutive batches of 10 concurrent requests
  let totalErrors = 0;
  for (let batch = 1; batch <= 10; batch++) {
    db.reset();
    const promises = Array.from({ length: CONCURRENCY }, async (_, idx) => {
      try {
        await db.atomicUpsertIncrement(linkId, bucket);
        return { status: 302, req: idx };
      } catch (err) {
        return { status: 500, error: err.message };
      }
    });

    const results = await Promise.all(promises);
    const errors = results.filter((r) => r.status === 500);
    totalErrors += errors.length;

    const finalRow = db.table.get(`${linkId}:${bucket}`);
    assert.strictEqual(finalRow.count, CONCURRENCY, `Batch ${batch} count must equal ${CONCURRENCY}`);
  }

  console.log(`Verified 10 batches of ${CONCURRENCY} concurrent requests: ${totalErrors} errors.`);
  assert.strictEqual(totalErrors, 0, 'Atomic upsert must produce zero 500 errors across all runs');
  console.log('>>> VERIFICATION SUCCESS: Atomic upsert serialized concurrent increments with zero lost writes and zero errors.');
}

async function main() {
  await runRaceConditionReproduction();
  await runAtomicUpsertVerification();
  console.log('\n================================================================');
  console.log('>>> MODULE 03 BUILD VERIFICATION PASSED (100% DETERMINISTIC) <<<');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
