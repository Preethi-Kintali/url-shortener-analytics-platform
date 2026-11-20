# Module 02 CONTEXT: Reading Logs Like a Story

## 1. The Core Engineering Challenge: Logs as the Black Box Recorder
In high-throughput distributed systems, when outages occur at 3 AM, human memory is non-existent. Telemetry and logs represent the sole empirical witness—the black box flight recorder of the application.

Most developers write logs as haphazard "sticky notes" scattered across files (`console.log('here')`, `print('got to this point')`). In production with millions of operations, unstructured strings create an impenetrable wall of noise that prevents rapid root cause isolation.

### Unstructured vs. Structured Logging
- **Unstructured Logging**: `Error: could not find link abc123`
  - Cannot be reliably queried, filtered, or correlated across asynchronous boundaries or services.
- **Structured Logging**: Standardized JSON envelopes containing uniform contextual metadata:
  ```json
  {
    "timestamp": "2025-01-15T03:22:41.018Z",
    "level": "error",
    "message": "Link not found",
    "request_id": "req-7f3a",
    "method": "GET",
    "path": "/r/abc123",
    "status": 404,
    "duration_ms": 12
  }
  ```

### The Log Level Triage Hierarchy
Log levels function identically to emergency room triage:
- `FATAL / CRITICAL` (Red tag): Process death, unrecoverable crash, missing database connection.
- `ERROR` (Red-Yellow): An individual request or transaction failed (HTTP 500, failed write). Service remains running.
- `WARN` (Yellow tag): Anomaly or degradation detected (retry succeeded on attempt 3, slow DB write, cache miss spike).
- `INFO` (Green tag): Baseline healthy narrative (request received, entity created, redirect executed).
- `DEBUG`: Internal execution details (SQL queries, payload schemas, cache keys).

---

## 2. Micro-Exercise: Reconstructing the Story from 10 Structured Log Lines

### Provided Log Stream
```json
{"ts":"2025-01-15T14:00:01.003Z","level":"info","req_id":"r-001","msg":"request received","method":"POST","path":"/links","status":null}
{"ts":"2025-01-15T14:00:01.045Z","level":"info","req_id":"r-001","msg":"link created","short_code":"xK9mQ","url":"https://example.com"}
{"ts":"2025-01-15T14:00:01.048Z","level":"info","req_id":"r-001","msg":"response sent","status":201,"duration_ms":45}
{"ts":"2025-01-15T14:00:02.100Z","level":"info","req_id":"r-002","msg":"request received","method":"GET","path":"/r/xK9mQ","status":null}
{"ts":"2025-01-15T14:00:02.112Z","level":"info","req_id":"r-002","msg":"redirect executed","short_code":"xK9mQ","duration_ms":12}
{"ts":"2025-01-15T14:00:05.500Z","level":"info","req_id":"r-003","msg":"request received","method":"GET","path":"/r/nope99","status":null}
{"ts":"2025-01-15T14:00:05.510Z","level":"error","req_id":"r-003","msg":"link not found","short_code":"nope99","status":404,"duration_ms":10}
{"ts":"2025-01-15T14:00:08.200Z","level":"info","req_id":"r-004","msg":"request received","method":"POST","path":"/links","status":null}
{"ts":"2025-01-15T14:00:08.890Z","level":"warn","req_id":"r-004","msg":"slow db write","short_code":"pL3nR","duration_ms":680}
{"ts":"2025-01-15T14:00:08.900Z","level":"info","req_id":"r-004","msg":"response sent","status":201,"duration_ms":700}
```

### Analysis & Answers

#### Question 1: Which request failed? How do you know?
- **Failing Request**: Request `r-003` (`GET /r/nope99`).
- **Evidence**:
  - The log explicitly specifies `"level": "error"`.
  - The message is `"msg": "link not found"` for short code `nope99`.
  - The resulting HTTP status code was `404`, ending the request lifecycle after `10ms` without executing a redirect.

#### Question 2: How long did the slowest request take? What might explain the slowness?
- **Slowest Request**: Request `r-004` (`POST /links`).
- **Duration**: **700 ms** (`duration_ms: 700`).
- **Contributing Cause**:
  - A warning was emitted at `14:00:08.890Z`: `"level": "warn"`, `"msg": "slow db write"`, with a database write duration of `680 ms`.
  - The database persistence layer accounted for $97.1\%$ of the entire request duration ($680\text{ ms} / 700\text{ ms}$).
  - Potential architectural causes include:
    1. Database connection pool saturation / acquisition delay.
    2. Write-lock contention on the `links` table.
    3. Disk I/O or WAL checkpoint latency on the PostgreSQL volume.
    4. Index maintenance overhead during B-Tree page splits.

#### Question 3: Is there a pattern to the failures, or was it a one-off?
- **Pattern Assessment**: It is an isolated, expected **one-off client error** (404 Not Found), not a systemic platform outage or cascading defect.
- **Narrative Flow**:
  - `r-001` cleanly created short code `xK9mQ` in 45ms.
  - `r-002` successfully looked up and redirected `xK9mQ` in 12ms.
  - `r-003` was a lookup for an unmapped code (`nope99`), returning 404 cleanly in 10ms.
  - `r-004` successfully created link `pL3nR` (201 Created), demonstrating write availability despite the transient database latency spike.
  - No uncaught 500 exceptions, crash loops, or connection dropouts were observed.
