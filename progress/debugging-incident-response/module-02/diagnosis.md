# Module 02 Diagnosis Notes: Reading Logs Like a Story

## Bug #3: Log Level Misconfiguration & Precedence Short-Circuit
- **Symptom**:
  - In production logs, isolated error responses (`404 Link not found`, `500 Internal Server Error`) appear without any preceding `"request received"` or succeeding `"response sent"` log entries.
  - Failures appear "out of thin air," eliminating request correlation context, caller IP, request IDs, and payload metadata.
- **Hypothesis Formulation**:
  - *Hypothesis A*: Request logging middleware is unmounted or failing silently before reaching routes.
  - *Hypothesis B*: The logger's configured level threshold is set too high (`WARN` or `ERROR`), filtering out `INFO`-level request/response lines. A hardcoded configuration file value is overriding the `LOG_LEVEL=info` environment variable due to short-circuiting logic (`config.level || process.env.LOG_LEVEL`).
- **Investigation & Root Cause Analysis**:
  - Traced the configuration loading path:
    ```javascript
    const logLevel = (config.logging && config.logging.level) || process.env.LOG_LEVEL || 'info';
    ```
  - In `config.json` (or static application configuration), `logging.level` was hardcoded to `'warn'`.
  - Because `config.logging.level` was truthy, JavaScript's logical OR (`||`) short-circuited immediately. The runtime environment variable `LOG_LEVEL=info` was completely ignored.
  - As a result, all `INFO` logs (request intake, routing, redirects, completion) were suppressed, while only `WARN` and `ERROR` events were emitted.
- **Fix & Architectural Remediation**:
  - Inverted precedence order so that runtime environment variables take precedence over static configuration file defaults:
    ```javascript
    const logLevel = process.env.LOG_LEVEL || (config.logging && config.logging.level) || 'info';
    ```
  - Enforced `LOG_LEVEL=info` in the runtime environment.
- **Verification Proof**:
  - Executed simulated request suite under both configurations via `test-bugs-3-and-4.js`:
    - *Before*: 3 requests generated only 1 log line (`[ERROR] link not found`). Zero intake entries.
    - *After*: 3 requests generated 7 structured log lines, capturing full lifecycle from intake (`r-103 request received`) to resolution (`r-103 link not found 404`).

---

## Bug #4: Timestamp Timezone Mismatch (Midnight UTC Gap)
- **Symptom**:
  - User report: "Links created around midnight sometimes return 404 for a few hours, then magically start working. It only seems to happen late at night."
  - The failure is intermittent, time-dependent, and seemingly self-healing.
- **Hypothesis Formulation**:
  - *Hypothesis A*: Background job or cache expiration sets a zero-second TTL near midnight.
  - *Hypothesis B*: A timezone discrepancy exists between application telemetry (UTC) and database persistence/queries (local server timezone, e.g., EST / UTC-5). Temporal comparisons against date boundaries or `NOW()` cause newly created links to fall into a 5-hour visibility gap between UTC midnight and local midnight.
- **Timeline & Telemetry Reconstruction**:
  - Creation log: `"ts": "2025-01-15T23:58:00.000Z"` (UTC).
  - Database stored timestamp: `2025-01-15 18:58:00` (stored as local time or without timezone offset).
  - When the clock passes midnight UTC (`2025-01-16T00:00:00Z`):
    - The application looks for links created on the active date partition (`2025-01-16`), or compares `WHERE created_at >= CURRENT_DATE`.
    - However, the database clock in EST is still at `19:00:00` on `2025-01-15`.
    - For the 5 hours between UTC midnight and EST midnight, recently created links fall outside the queried temporal partition and return 404.
    - At 05:00 UTC (00:00 EST), the database clock reaches the next day, and the links "magically" reappear.
- **Fix & Architectural Remediation**:
  - Enforce the Universal Production Time Law: **Store everything in UTC; convert to local time strictly at the human UI display boundary.**
  - Schema: Configure database timestamp columns as `TIMESTAMPTZ` (UTC).
  - Persistence: Ensure application writes standardized ISO-8601 UTC strings (`new Date().toISOString()`) or epoch millisecond integers.
  - Queries: Strictly compare using UTC bounds (`NOW() AT TIME ZONE 'UTC'`).
- **Verification Proof**:
  - Simulated link created at `23:58:00.000Z` UTC and queried across the midnight boundary:
    - *Broken implementation*: Lookup at `00:05:00.000Z` returned `404 Not Found` due to date partition mismatch.
    - *Fixed implementation*: Lookups at `23:59:00Z`, `00:05:00Z`, and `03:00:00Z` all returned `302 Found` with exact target location and zero delay.
