// ============================================================================
// MODULE 04 BUILD: Performance Diagnostics & Tooling Verification
// ============================================================================
// Bug #6: Connection Pool Exhaustion / Memory Leak on Unhandled Error Paths
// Bug #7: N+1 Database Query Explosion on Links List Endpoint
// ============================================================================

const assert = require('assert');

// ----------------------------------------------------------------------------
// SIMULATION 1: BUG #6 (Connection Pool Leak on Error Path)
// ----------------------------------------------------------------------------
class MockConnectionPool {
  constructor(maxSize = 10) {
    this.maxSize = maxSize;
    this.activeConnections = 0;
    this.totalAllocated = 0;
  }

  reset() {
    this.activeConnections = 0;
    this.totalAllocated = 0;
  }

  async acquire() {
    if (this.activeConnections >= this.maxSize) {
      throw new Error(`ConnectionPoolExhaustionError: Pool size limit (${this.maxSize}) reached. No connections available.`);
    }
    this.activeConnections += 1;
    this.totalAllocated += 1;
    return {
      id: this.totalAllocated,
      query: async (shouldFail = false) => {
        if (shouldFail) {
          throw new Error('DatabaseQueryExecutionError: Connection query failed');
        }
        return { rows: [{ result: 'ok' }] };
      },
      release: () => {
        if (this.activeConnections > 0) {
          this.activeConnections -= 1;
        }
      },
    };
  }
}

// Vulnerable implementation: release() inside try block
async function vulnerableQueryHandler(pool, shouldFail) {
  try {
    const conn = await pool.acquire();
    const res = await conn.query(shouldFail);
    conn.release(); // <-- ONLY REACHED ON SUCCESS!
    return { status: 200, res };
  } catch (err) {
    // Connection is LEAKED because release() was skipped
    return { status: 500, error: err.message };
  }
}

// Fixed implementation: release() in finally block
async function fixedQueryHandler(pool, shouldFail) {
  let conn;
  try {
    conn = await pool.acquire();
    const res = await conn.query(shouldFail);
    return { status: 200, res };
  } catch (err) {
    return { status: 500, error: err.message };
  } finally {
    if (conn) {
      conn.release(); // <-- ALWAYS EXECUTED REGARDLESS OF OUTCOME
    }
  }
}

async function verifyBug6ConnectionLeak() {
  console.log('=== PART 1: Diagnosing Bug #6 (DB Connection Pool Exhaustion) ===');
  const pool = new MockConnectionPool(10);

  // 1. Reproduce pool exhaustion under vulnerable pattern
  // Suppose 2% of requests experience a database error or invalid query
  let failureObserved = false;
  for (let req = 1; req <= 30; req++) {
    const hasError = req % 2 === 0; // Trigger an error every 2nd request
    const result = await vulnerableQueryHandler(pool, hasError);
    if (result.error && result.error.includes('ConnectionPoolExhaustionError')) {
      console.log(`[REPRODUCED] Request #${req} crashed: ${result.error}`);
      console.log(`Pool state: ${pool.activeConnections}/${pool.maxSize} active connections leaked.`);
      failureObserved = true;
      break;
    }
  }
  assert(failureObserved, 'Vulnerable handler must exhaust the connection pool on error paths');

  // 2. Verify fixed implementation with finally block
  pool.reset();
  console.log('\n--- Verifying Fixed Implementation (2,000 requests with 10% error rate) ---');
  let exhaustionErrors = 0;
  for (let req = 1; req <= 2000; req++) {
    const hasError = req % 10 === 0; // 10% errors
    const result = await fixedQueryHandler(pool, hasError);
    if (result.error && result.error.includes('ConnectionPoolExhaustionError')) {
      exhaustionErrors += 1;
    }
  }

  console.log(`Completed 2,000 requests against pool. Exhaustion errors: ${exhaustionErrors}`);
  console.log(`Final Pool State: ${pool.activeConnections}/${pool.maxSize} active connections.`);
  assert.strictEqual(exhaustionErrors, 0, 'Zero pool exhaustion errors expected under fixed handler');
  assert.strictEqual(pool.activeConnections, 0, 'All connections must be cleanly returned to pool');
  console.log('>>> BUG #6 RESOLVED: Finally-block connection management eliminates pool leaks.\n');
}

// ----------------------------------------------------------------------------
// SIMULATION 2: BUG #7 (N+1 Query Explosion on Links List Endpoint)
// ----------------------------------------------------------------------------
class MockQueryProfiler {
  constructor() {
    this.queries = [];
  }

  reset() {
    this.queries = [];
  }

  logQuery(sql) {
    this.queries.push({ sql, timestamp: Date.now() });
  }
}

// Vulnerable N+1 Implementation (Lazy-Loading Fallback)
async function vulnerableFindAllLinks(profiler, limit = 50) {
  profiler.logQuery('SELECT * FROM links ORDER BY created_at DESC LIMIT ' + limit);
  const links = Array.from({ length: limit }, (_, i) => ({
    id: i + 1,
    code: `link_${i + 1}`,
    long_url: `https://example.com/target_${i + 1}`,
  }));

  // N+1 Anti-Pattern: Individual query per link
  for (const link of links) {
    profiler.logQuery(`SELECT * FROM analytics WHERE link_id = ${link.id}`);
  }

  return links;
}

// Remediated Single-Query Eager Loading via JOIN
async function fixedFindAllLinks(profiler, limit = 50) {
  // Single atomic JOIN query
  profiler.logQuery(
    `SELECT links.*, analytics.count, analytics.last_accessed_at ` +
    `FROM links ` +
    `LEFT JOIN analytics ON analytics.link_id = links.id ` +
    `ORDER BY links.created_at DESC LIMIT ${limit}`
  );

  const links = Array.from({ length: limit }, (_, i) => ({
    id: i + 1,
    code: `link_${i + 1}`,
    long_url: `https://example.com/target_${i + 1}`,
    clicks: 10,
    last_accessed_at: new Date().toISOString(),
  }));

  return links;
}

async function verifyBug7QueryExplosion() {
  console.log('=== PART 2: Diagnosing Bug #7 (N+1 Database Query Explosion) ===');
  const profiler = new MockQueryProfiler();

  // 1. Profile vulnerable N+1 behavior
  await vulnerableFindAllLinks(profiler, 50);
  const vulnerableCount = profiler.queries.length;
  console.log(`[PROFILED] GET /links (50 rows) under Lazy Loading generated: ${vulnerableCount} queries.`);
  console.log(`  - 1 parent query: ${profiler.queries[0].sql}`);
  console.log(`  - 50 child queries: ${profiler.queries[1].sql} ... ${profiler.queries[50].sql}`);
  assert.strictEqual(vulnerableCount, 51, 'Expected 1 parent + 50 child queries (N+1 pattern)');

  // 2. Profile fixed Eager Loading (Single JOIN query)
  profiler.reset();
  await fixedFindAllLinks(profiler, 50);
  const fixedCount = profiler.queries.length;
  console.log(`\n[PROFILED] GET /links (50 rows) under Eager Loading generated: ${fixedCount} query.`);
  console.log(`  - Executed Query: ${profiler.queries[0].sql}`);
  assert.strictEqual(fixedCount, 1, 'Expected single consolidated JOIN query');

  const queryReductionPercent = ((vulnerableCount - fixedCount) / vulnerableCount) * 100;
  console.log(`\nQuery count reduction: ${vulnerableCount} -> ${fixedCount} (${queryReductionPercent.toFixed(1)}% database roundtrip reduction)`);
  console.log('>>> BUG #7 RESOLVED: Single JOIN query replaces 51 serialized roundtrips.\n');
}

async function main() {
  await verifyBug6ConnectionLeak();
  await verifyBug7QueryExplosion();
  console.log('================================================================');
  console.log('>>> MODULE 04 BUILD VERIFICATION PASSED (100% DETERMINISTIC) <<<');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
