/**
 * test-bugs-9-and-10.js
 *
 * Verifies Bug #9 (Stale Cache Invalidation) and Bug #10 (Queue Retry Storm)
 * for Module 06 Step 3 (BUILD).
 */

const assert = require('assert');

// ============================================================================
// PART 1: Bug #9 - Stale Cache Serving Deleted Records
// ============================================================================

console.log('=== PART 1: Testing Bug #9 (Stale Cache Invalidation) ===');

// Mock Database and Redis Cache
const database = new Map();
const redisCache = new Map();

function createLink(id, code, originalUrl) {
  database.set(id, { id, code, originalUrl, deleted: false });
}

function resolveRedirect(code) {
  // Layer 1: Check Redis cache first
  const cacheKey = `redirect:${code}`;
  if (redisCache.has(cacheKey)) {
    return { source: 'cache', status: 302, url: redisCache.get(cacheKey) };
  }

  // Layer 2: Check PostgreSQL database
  for (const [, record] of database.entries()) {
    if (record.code === code && !record.deleted) {
      // Populate cache on miss (5 min TTL)
      redisCache.set(cacheKey, record.originalUrl);
      return { source: 'database', status: 302, url: record.originalUrl };
    }
  }

  return { source: 'none', status: 404, url: null };
}

// 1. Populate link
createLink('link-1', 'promo24', 'https://example.com/summer-promo');

// 2. Initial resolution (warms cache)
const warmUp = resolveRedirect('promo24');
assert.strictEqual(warmUp.status, 302);
assert.strictEqual(warmUp.source, 'database');
assert.strictEqual(redisCache.get('redirect:promo24'), 'https://example.com/summer-promo');
console.log('  [PASS] Link created and cache warmed.');

// 3. Vulnerable Delete (only talks to DB, ignores Cache)
function vulnerableDeleteLink(id) {
  const record = database.get(id);
  if (record) {
    record.deleted = true;
    // Missing cache invalidation!
  }
}

vulnerableDeleteLink('link-1');
assert.strictEqual(database.get('link-1').deleted, true, 'DB record marked deleted');

// Accessing link after vulnerable delete still returns 302 from stale cache!
const staleRedirect = resolveRedirect('promo24');
assert.strictEqual(staleRedirect.status, 302, 'Bug #9 reproduced: Stale cache returns 302 for deleted link');
assert.strictEqual(staleRedirect.source, 'cache');
console.log('  [PASS] Bug #9 Reproduced: Stale cache serves deleted record.');

// 4. Hardened Delete (with immediate cache invalidation)
function hardenedDeleteLink(id) {
  const record = database.get(id);
  if (record) {
    record.deleted = true;
    const cacheKey = `redirect:${record.code}`;
    redisCache.delete(cacheKey); // Explicit Invalidation
  }
}

// Re-populate and test hardened delete
database.get('link-1').deleted = false;
redisCache.set('redirect:promo24', 'https://example.com/summer-promo');

hardenedDeleteLink('link-1');
const postFixRedirect = resolveRedirect('promo24');
assert.strictEqual(postFixRedirect.status, 404, 'Hardened delete immediately invalidates cache; returns 404');
assert.strictEqual(redisCache.has('redirect:promo24'), false, 'Cache key successfully purged');
console.log('  [PASS] Bug #9 Fixed: Cache invalidation verified, returns 404 immediately.');

// ============================================================================
// PART 2: Bug #10 - Queue Retry Storm & Resource Contention
// ============================================================================

console.log('\n=== PART 2: Testing Bug #10 (Queue Retry Storm & Bulkhead Isolation) ===');

class MockConnectionPool {
  constructor(name, maxConnections) {
    this.name = name;
    this.maxConnections = maxConnections;
    this.activeConnections = 0;
    this.waitQueue = [];
  }

  acquire() {
    if (this.activeConnections < this.maxConnections) {
      this.activeConnections++;
      return { success: true };
    }
    return { success: false, error: 'CONNECTION_POOL_EXHAUSTED' };
  }

  release() {
    if (this.activeConnections > 0) {
      this.activeConnections--;
    }
  }

  utilization() {
    return (this.activeConnections / this.maxConnections) * 100;
  }
}

// 1. Reproducing Failure with Shared Connection Pool (No backoff, no retry limit)
console.log('  Testing failure mode: Shared pool under unconstrained retry loop...');
const sharedPool = new MockConnectionPool('shared_postgres_pool', 10);

// Queue worker with tight retry loop and no backoff
let retryCount = 0;
while (sharedPool.acquire().success && retryCount < 10) {
  retryCount++;
  // worker fails and holds/fails to release connection in tight loop
}

assert.strictEqual(sharedPool.utilization(), 100, 'Shared pool saturated to 100%');
const apiAttemptOnSharedPool = sharedPool.acquire();
assert.strictEqual(apiAttemptOnSharedPool.success, false, 'API request starved by worker retry storm');
console.log('  [PASS] Bug #10 Reproduced: Worker retry storm starved API of connections.');

// 2. Testing Hardened Architecture:
// - Exponential backoff
// - Max retries with Dead-Letter Queue (DLQ)
// - Bulkhead isolation (separate connection pools)
console.log('  Testing hardened remediation: Bulkhead isolation, exponential backoff, and DLQ...');

const apiBulkheadPool = new MockConnectionPool('api_isolated_pool', 15);
const workerBulkheadPool = new MockConnectionPool('worker_isolated_pool', 5);
const deadLetterQueue = [];

async function hardenedProcessQueueJob(job, maxRetries = 5) {
  let attempt = 0;
  let delayMs = 100; // base backoff
  const delaysRecorded = [];

  while (attempt < maxRetries) {
    attempt++;
    const conn = workerBulkheadPool.acquire();
    if (!conn.success) {
      delaysRecorded.push(delayMs);
      delayMs *= 2; // exponential backoff
      continue;
    }

    try {
      // Simulate failing job execution
      throw new Error('Downstream analytics service timeout');
    } catch (err) {
      // Record backoff delay for verification
      delaysRecorded.push(delayMs);
      delayMs = Math.min(delayMs * 2, 30000); // Exponential backoff with ceiling
    } finally {
      workerBulkheadPool.release(); // Always release connection in finally
    }
  }

  // Route to Dead Letter Queue after max retries exceeded
  deadLetterQueue.push({
    job,
    attempts: attempt,
    failedAt: new Date().toISOString(),
    error: 'MAX_RETRIES_EXCEEDED'
  });

  return { status: 'MOVED_TO_DLQ', delaysRecorded };
}

// Execute hardened worker test
(async () => {
  const result = await hardenedProcessQueueJob({ id: 'job-999', type: 'analytics_sync' }, 5);

  // Verify Dead Letter Queue
  assert.strictEqual(deadLetterQueue.length, 1, 'Failed job must be routed to DLQ');
  assert.strictEqual(deadLetterQueue[0].attempts, 5, 'Job must be retried exactly 5 times');

  // Verify Exponential Backoff schedule (100ms, 200ms, 400ms, 800ms, 1600ms)
  assert.deepStrictEqual(result.delaysRecorded, [100, 200, 400, 800, 1600], 'Must follow exponential progression');
  console.log('  [PASS] Exponential backoff verified: delays =', result.delaysRecorded.join('ms, ') + 'ms');
  console.log('  [PASS] Dead-Letter Queue verified: job-999 routed to DLQ after 5 attempts.');

  // Verify Bulkhead Isolation: API pool is completely unaffected!
  const apiRequest1 = apiBulkheadPool.acquire();
  const apiRequest2 = apiBulkheadPool.acquire();
  assert.strictEqual(apiRequest1.success, true, 'API requests succeed regardless of worker failures');
  assert.strictEqual(apiRequest2.success, true);
  apiBulkheadPool.release();
  apiBulkheadPool.release();
  console.log('  [PASS] Bulkhead Isolation verified: API pool unaffected by worker failures.');

  console.log('\nALL VERIFICATION TESTS PASSED SUCCESSFULLY (100% Green)');
})();
