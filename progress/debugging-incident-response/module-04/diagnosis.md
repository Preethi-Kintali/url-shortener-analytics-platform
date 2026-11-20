# Module 04 Diagnosis Notes: The Debugging Toolbox

## 1. Tool-Led Investigation Overview
In alignment with the core premise of Module 04, both performance anomalies were investigated using runtime observability tools rather than passive code inspection:
- **Bug #6**: Diagnosed using heap memory profiling and connection pool metric tracking (`activeConnections` vs. `maxPoolSize`).
- **Bug #7**: Diagnosed using SQL query profiling and execution plan analysis (`EXPLAIN ANALYZE`).

---

## 2. Bug #6: Memory Leak & Connection Pool Exhaustion on Error Paths

### Symptom & Observed Behavior
- Under moderate production traffic, the service performs smoothly for the first ~1,000 requests.
- Latency begins creeping upward between 1,500 and 2,000 requests.
- Near 2,000 requests, the service becomes completely unresponsive, resulting in `ConnectionPoolExhaustionError`, gateway timeouts (HTTP 504), or process termination by the container supervisor (`OOMKilled`).

### Profiler Findings
- Tracking connection pool metrics reveals that `activeConnections` increases monotonically whenever requests trigger an error path (e.g. invalid query input, constraint violations, or database timeouts).
- Connection objects are retained in the V8 heap because the pool registry retains references to acquired connections, preventing garbage collection.

### Root Cause Analysis
The connection lifecycle in the database adapter was structured with cleanup restricted to the happy path:
```typescript
// VULNERABLE PATTERN: Connection Leak on Error Path
try {
  const connection = await pool.acquire();
  const result = await connection.query(...);
  connection.release(); // <-- Only executed on SUCCESS!
  return result;
} catch (error) {
  logger.error(error);
  return errorResponse; // <-- LEAK: release() is bypassed when an exception is thrown!
}
```
Even if only 1% to 2% of requests hit error conditions, a pool of 20 to 50 connections is completely exhausted after a few thousand requests. Once the pool is full, subsequent requests block indefinitely awaiting an available connection until they time out.

### Engineering Remediation
The cleanup operation must be moved to an unconditional `finally` block:
```typescript
// REMEDIATED PATTERN: Guaranteed Release
let connection;
try {
  connection = await pool.acquire();
  return await connection.query(...);
} catch (error) {
  logger.error(error);
  return errorResponse;
} finally {
  if (connection) {
    connection.release(); // <-- Executes unconditionally across success, return, or exception
  }
}
```

### Verification Proof
- Automated test: `progress/debugging-incident-response/module-04/test-bugs-6-and-7.js`.
- Vulnerable handler crashed at Request #21 when pool size limit (10) was reached.
- Fixed handler executed **2,000 consecutive requests** with a 10% injected error rate:
  - **0** `ConnectionPoolExhaustionError` occurrences.
  - Final pool state: **0/10 active connections** (100% pool recovery).

---

## 3. Bug #7: N+1 Database Query Explosion on `GET /links`

### Symptom & Observed Behavior
- Fetching 50 short links via `GET /links` takes over 3,000ms.
- Latency scales linearly with page size ($O(N)$ database roundtrips).

### Query Profiler Findings
Enabling SQL query logging revealed that a single HTTP request for 50 links triggered **51 separate database queries**:
```sql
-- 1. Parent Query
SELECT * FROM links ORDER BY created_at DESC LIMIT 50;

-- 2. Child Queries (repeated 50 times)
SELECT * FROM analytics WHERE link_id = 1;
SELECT * FROM analytics WHERE link_id = 2;
...
SELECT * FROM analytics WHERE link_id = 50;
```

### Root Cause Analysis
- The application code specified eager loading in its query options.
- However, an underlying ORM dependency bump changed the configuration syntax and defaults. The ORM silently ignored the deprecated eager-loading flag and fell back to lazy-loading child relations on demand as the serializer iterated over the array.
- Even if each individual query takes only 2ms in PostgreSQL, 51 serialized network roundtrips, connection checkouts, and query parsing operations add up to hundreds of milliseconds of I/O latency, which cascades into multi-second delays under concurrent load.

### Engineering Remediation
Consolidate the parent and child queries into a single SQL `LEFT JOIN` with index utilization:
```sql
SELECT 
  links.id,
  links.code,
  links.long_url,
  links.created_at,
  COALESCE(analytics.count, 0) AS click_count,
  analytics.last_accessed_at
FROM links
LEFT JOIN analytics ON analytics.link_id = links.id
ORDER BY links.created_at DESC
LIMIT 50;
```

### Verification Proof
- Automated test: `progress/debugging-incident-response/module-04/test-bugs-6-and-7.js`.
- Query count reduced from **51 queries to 1 query** (a **98.0% reduction** in database roundtrips).
- Response latency dropped from $>3000\text{ms}$ to $<50\text{ms}$.
