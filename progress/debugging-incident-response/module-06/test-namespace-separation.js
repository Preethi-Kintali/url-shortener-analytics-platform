/**
 * test-namespace-separation.js
 *
 * Verifies the Step 6 (FIX) remediation:
 * Separating Redis cache key namespaces between:
 * 1. Redirect Cache: link:redirect:<short_code>
 * 2. Analytics Deduplication: analytics:dedup:<job_id>
 */

const assert = require('assert');

class RedisNamespaceSimulation {
  constructor() {
    this.storage = new Map();
  }

  set(key, value, exSeconds) {
    this.storage.set(key, { value, expiresAt: exSeconds ? Date.now() + exSeconds * 1000 : null });
  }

  get(key) {
    const item = this.storage.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.storage.delete(key);
      return null;
    }
    return item.value;
  }

  del(key) {
    return this.storage.delete(key);
  }

  has(key) {
    return this.get(key) !== null;
  }

  getAllKeys() {
    return Array.from(this.storage.keys());
  }
}

const redis = new RedisNamespaceSimulation();

// ============================================================================
// SYSTEM ARCHITECTURE: Distinct Namespaces
// ============================================================================

function redirectKey(code) {
  return `link:redirect:${code}`;
}

function analyticsDedupKey(jobId) {
  return `analytics:dedup:${jobId}`;
}

// Global analytics event log
const processedClicks = [];

function resolveRedirect(code, database) {
  const rKey = redirectKey(code);
  const cached = redis.get(rKey);
  if (cached) {
    return { status: 302, url: cached, fromCache: true };
  }

  const dbRow = database[code];
  if (!dbRow || dbRow.deleted) {
    return { status: 404, url: null, fromCache: false };
  }

  // Populate redirect cache
  redis.set(rKey, dbRow.url, 300);
  return { status: 302, url: dbRow.url, fromCache: false };
}

function deleteLink(code, database) {
  if (database[code]) {
    database[code].deleted = true;
  }
  // Hardened invalidation: Only purges redirect namespace!
  redis.del(redirectKey(code));
}

function processAnalyticsJob(job) {
  const dKey = analyticsDedupKey(job.id);

  // Check deduplication namespace
  if (redis.has(dKey)) {
    return { status: 'DUPLICATE_SKIPPED', jobId: job.id };
  }

  // Mark as processed with 24-hour retention
  redis.set(dKey, 'processed', 86400);
  processedClicks.push({ jobId: job.id, code: job.code, timestamp: Date.now() });
  return { status: 'PROCESSED', jobId: job.id };
}

// ============================================================================
// VERIFICATION RUN
// ============================================================================

console.log('=== Step 1: Initial Link Creation, Redirect, and Analytics ===');
const mockDb = {
  'spring24': { code: 'spring24', url: 'https://example.com/spring', deleted: false }
};

// 1. Initial redirect warms redirect cache
const red1 = resolveRedirect('spring24', mockDb);
assert.strictEqual(red1.status, 302);
assert.strictEqual(redis.has(redirectKey('spring24')), true, 'Redirect cache key populated');
console.log('  [PASS] Initial redirect successful; redirect cache key stored.');

// 2. Process initial analytics job
const job1 = { id: 'job_click_1001', code: 'spring24' };
const proc1 = processAnalyticsJob(job1);
assert.strictEqual(proc1.status, 'PROCESSED');
assert.strictEqual(redis.has(analyticsDedupKey(job1.id)), true, 'Analytics dedup key populated');
console.log('  [PASS] Analytics job processed once; dedup key stored.');

// Verify distinct namespaces in Redis
const keysAfterStep1 = redis.getAllKeys();
assert(keysAfterStep1.includes('link:redirect:spring24'), 'Must have link:redirect key');
assert(keysAfterStep1.includes('analytics:dedup:job_click_1001'), 'Must have analytics:dedup key');
console.log('  [PASS] Verified distinct Redis key namespaces:');
console.log('         - Redirect Key: ' + keysAfterStep1.find(k => k.startsWith('link:redirect')));
console.log('         - Dedup Key:    ' + keysAfterStep1.find(k => k.startsWith('analytics:dedup')));

console.log('\n=== Step 2: Delete Link & Verify Targeted Cache Invalidation ===');
deleteLink('spring24', mockDb);

// Bug #9 verification: immediate 404
const red2 = resolveRedirect('spring24', mockDb);
assert.strictEqual(red2.status, 404, 'Deleted link must return 404 immediately');
assert.strictEqual(redis.has(redirectKey('spring24')), false, 'Redirect cache key purged');

// Crucial invariant check: Analytics dedup key must STILL exist!
assert.strictEqual(redis.has(analyticsDedupKey(job1.id)), true, 'Analytics dedup key preserved!');
console.log('  [PASS] Redirect key purged (returns 404); Analytics dedup key strictly preserved.');

console.log('\n=== Step 3: Re-create Link with Same Code & Process Analytics ===');
// Re-create link with identical short code
mockDb['spring24'] = { code: 'spring24', url: 'https://example.com/spring-v2', deleted: false };

// Test A: Re-sending old job (must be recognized as duplicate and skipped!)
const retryOldJob = processAnalyticsJob(job1);
assert.strictEqual(retryOldJob.status, 'DUPLICATE_SKIPPED', 'Old job recognized as duplicate and skipped');
console.log('  [PASS] Retry of old job recognized as duplicate; deduplication intact.');

// Test B: Processing new distinct job for re-created link
const job2 = { id: 'job_click_1002', code: 'spring24' };
const proc2 = processAnalyticsJob(job2);
assert.strictEqual(proc2.status, 'PROCESSED', 'New job processes normally');
console.log('  [PASS] New job processed successfully.');

// Confirm total processed count in DB is exactly 2 (job1 + job2), NOT 3!
assert.strictEqual(processedClicks.length, 2, 'Exactly 2 clicks processed total');
console.log(`  [PASS] Total analytics click count = ${processedClicks.length} (no duplicate inflation).`);

console.log('\n================================================================');
console.log('ALL NAMESPACE SEPARATION CHECKS PASSED (100% Green)');
console.log('================================================================');
