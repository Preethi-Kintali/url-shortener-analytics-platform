# Module 03 FIX Report: Combined Atomic Upsert with Monotonic Timestamp Invariant

## 1. Architectural Problem: The Two-Query Race Condition

### The Vulnerable Architecture
Previously, the redirect analytics handler performed two distinct operations against PostgreSQL:
1. **Query 1 (Upsert)**:
   ```sql
   INSERT INTO analytics (link_id, timestamp_bucket, count)
   VALUES ($1, $2, 1)
   ON CONFLICT (link_id, timestamp_bucket)
   DO UPDATE SET count = analytics.count + 1;
   ```
2. **Query 2 (Separate Timestamp Update)**:
   ```sql
   UPDATE analytics 
   SET last_accessed_at = $requestTimestamp 
   WHERE link_id = $1 AND timestamp_bucket = $2;
   ```

### The Failure Mechanism (Lost Update / LWW Inversion)
While Query 1 is atomic and safe under concurrency, Query 2 introduces an asynchronous race window:
- **Arrival**: Request $A$ arrives at $T=100\text{ms}$; Request $B$ arrives at $T=102\text{ms}$.
- **Execution**: Both requests execute Query 1 successfully.
- **Interleaving**: Request $B$ completes Query 2 first, writing `last_accessed_at = 102ms`.
- **Inversion**: Request $A$ (delayed by thread pool scheduling or GC) completes Query 2 second, writing `last_accessed_at = 100ms`.
- **Result**: Stale timestamp from Request $A$ overwrites Request $B$'s newer timestamp. The database records $100\text{ms}$ instead of $102\text{ms}$—silent data corruption with zero database exceptions.

---

## 2. Engineering Remediation: The Single-Turnstile Atomic Upsert

The remediation collapses both operations into a single atomic statement, eliminating the separate `UPDATE` query entirely and introducing the PostgreSQL `GREATEST` operator.

### Remediated SQL Architecture:
```sql
INSERT INTO analytics (link_id, timestamp_bucket, count, last_accessed_at)
VALUES ($1, $2, 1, $requestTimestamp)
ON CONFLICT (link_id, timestamp_bucket)
DO UPDATE SET
  count = analytics.count + 1,
  last_accessed_at = GREATEST(analytics.last_accessed_at, EXCLUDED.last_accessed_at);
```

### Invariant Guarantees:
1. **Atomicity**: The increment and timestamp assignment execute inside a single row-lock acquisition. No competing connection can observe or interleave between the count and timestamp updates.
2. **Monotonicity**: The `GREATEST()` function guarantees that the recorded timestamp can never move backward in time:
   $$\text{last\_accessed\_at}_{t+1} \ge \text{last\_accessed\_at}_t$$
   If an earlier request commits after a newer request, $\max(t_{\text{new}}, t_{\text{stale}}) = t_{\text{new}}$, preserving the accurate latest access time.
3. **Performance**: Halves the database roundtrip overhead from 2 network roundtrips to 1 per redirect.

---

## 3. Empirical Verification Results

Automated regression suite: `progress/debugging-incident-response/module-03/test-atomic-upsert-fix.js`
Executed 5 consecutive test batches of 10 concurrent requests (50 total concurrent requests with randomized execution latencies):

| Batch # | Concurrency | Expected Count | Persisted Count | Timestamp Match | Skew | Result |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Batch 1** | 10 | 10 | 10 | `2026-11-19T12:58:07.688Z` | $0\text{ms}$ | **PASS** |
| **Batch 2** | 10 | 10 | 10 | `2026-11-19T12:58:08.716Z` | $0\text{ms}$ | **PASS** |
| **Batch 3** | 10 | 10 | 10 | `2026-11-19T12:58:09.745Z` | $0\text{ms}$ | **PASS** |
| **Batch 4** | 10 | 10 | 10 | `2026-11-19T12:58:10.774Z` | $0\text{ms}$ | **PASS** |
| **Batch 5** | 10 | 10 | 10 | `2026-11-19T12:58:11.805Z` | $0\text{ms}$ | **PASS** |

### Summary of Proof:
- **0** Unique constraint violations (`P2002` / `23505` completely eliminated).
- **0** Lost counter increments ($100\%$ counter fidelity).
- **0** Timestamp inversions across all 5 runs.
