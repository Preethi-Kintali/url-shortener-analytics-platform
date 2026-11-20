# Module 03 Diagnosis Notes: Reproduction Science

## Bug #5: Analytics Unique Constraint Violation under Concurrency
- **Symptom**:
  - Intermittent HTTP 500 errors on the public redirect path (`GET /:shortCode`).
  - Errors cluster exclusively on popular, high-traffic short links.
  - The PostgreSQL error log reports:
    ```text
    ERROR: duplicate key value violates unique constraint "analytics_link_id_bucket_unique"
    DETAIL: Key (link_id, timestamp_bucket)=(42, 2025-01-15T14:00:00Z) already exists.
    ```
- **Hypothesis Formulation & Variable Isolation**:
  - *Candidate 1 (Data Shape)*: Rejected. The short code string and link metadata are standard alphanumeric strings.
  - *Candidate 2 (Timing / Boundary Rollover)*: Rejected. Failures occur throughout the hour, not merely on the hour boundary.
  - *Candidate 3 (Concurrency)*: **Confirmed**. Failures occur when multiple incoming requests for the same popular short code arrive within milliseconds of each other during a cold bucket window.
- **Investigation & Root Cause Analysis**:
  - Traced the application redirect lifecycle:
    1. Caller invokes `GET /:shortCode`.
    2. Route handler performs a check:
       `SELECT * FROM analytics WHERE link_id = $1 AND timestamp_bucket = $2`
    3. If row is missing, handler attempts an insert:
       `INSERT INTO analytics (link_id, timestamp_bucket, count) VALUES ($1, $2, 1)`
    4. If row exists, handler increments:
       `UPDATE analytics SET count = count + 1 WHERE ...`
  - **The Race Window**: When Request $A$ and Request $B$ execute simultaneously, both execute Step 2 before either commits Step 3. Both receive `null` from the SELECT. Request $A$ executes the INSERT successfully; Request $B$ attempts the same INSERT and crashes with unique constraint violation `23505`.
- **Minimal Reproduction Harness**:
  - Authored [progress/debugging-incident-response/module-03/repro-race.js](debugging-incident-response/module-03/repro-race.js) sending 10 concurrent requests via `Promise.all()`.
  - Result: 1 redirect succeeded, 9 requests crashed with HTTP 500 and unique constraint violation.
- **Fix & Architectural Remediation**:
  - Replaced the vulnerable check-then-act pattern with a single atomic PostgreSQL UPSERT:
    ```sql
    INSERT INTO analytics (link_id, timestamp_bucket, count, last_accessed_at)
    VALUES ($1, DATE_TRUNC('hour', NOW()), 1, NOW())
    ON CONFLICT (link_id, timestamp_bucket)
    DO UPDATE SET count = analytics.count + 1, last_accessed_at = NOW();
    ```
  - Because `ON CONFLICT` is handled atomically by PostgreSQL's internal engine locks, concurrent transactions serialize transparently without collision.
- **Verification Proof**:
  - Executed 10 consecutive batches of 10 concurrent requests (100 total concurrent operations).
  - Observed **0 errors (0% failure rate)** and exact counter reconciliation (`count = 10` per batch with zero lost writes).
