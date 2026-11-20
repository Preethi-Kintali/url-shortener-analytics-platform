# Module 02 VERIFY: Log Literacy & Temporal Verification

## Question 1: Reconstructing a Request Timeline Purely from Logs

### Selected Request: `r-103` (Non-Existent Short Code Access)
Using our verified structured logging output from `test-bugs-3-and-4.js`:

```json
{"ts":"2025-01-15T14:00:05.500Z","level":"info","req_id":"r-103","msg":"request received","method":"GET","path":"/r/missing","status":null}
{"ts":"2025-01-15T14:00:05.503Z","level":"debug","req_id":"r-103","msg":"cache lookup miss","key":"link:missing"}
{"ts":"2025-01-15T14:00:05.507Z","level":"debug","req_id":"r-103","msg":"db query executed","sql":"SELECT * FROM links WHERE code = $1 LIMIT 1","params":["missing"],"rows":0}
{"ts":"2025-01-15T14:00:05.510Z","level":"error","req_id":"r-103","msg":"link not found","code":"missing","status":404,"duration_ms":10}
```

### Detailed Timeline Reconstruction
1. **Intake (Arrival)**:
   - *Timestamp*: `14:00:05.500Z`
   - *Event*: Request `r-103` arrived via HTTP `GET` targeting path `/r/missing`. No status code is bound yet (`status: null`).
2. **Processing Steps**:
   - At `14:00:05.503Z` (+3ms): Service performed a cache check against Redis (`link:missing`), resulting in a cache miss.
   - At `14:00:05.507Z` (+4ms): Service fell back to PostgreSQL, executing an indexed lookup query for code `'missing'`. Database returned 0 rows.
3. **Resolution & Termination**:
   - At `14:00:05.510Z` (+3ms): The route handler identified the resource was absent and dispatched an HTTP 404 response.
   - *Duration*: Exactly **10 milliseconds** from socket intake to response dispatch.
4. **Log Gaps & Missing Telemetry**:
   - Currently missing: `user_agent` and client IP (or IP hash) to distinguish legitimate user typos from automated vulnerability scanners fuzzing short codes.
   - A dedicated `response sent` summary log with status code and duration should close the bracket uniformly across all routes.

---

## Question 2: Timezone Geography and Daylight Saving Time Dynamics

### 1. Server Configured in UTC (Offset Zero)
- If the database and application are both configured in UTC (`offset = 0`), **the bug does not exist**.
- `NOW()` in the database returns UTC, `CURRENT_DATE` flips at midnight UTC, and the application's UTC timestamp matches the database's date partition boundary with zero discrepancy.

### 2. Server in India Standard Time (IST = UTC+5:30)
- In India, local time is **ahead** of UTC by 5 hours and 30 minutes.
- When UTC is at `18:30` on January 15th, India's local clock crosses midnight into January 16th.
- A link created at `19:00` UTC on Jan 15th gets stored with a database date of `Jan 16`.
- An application querying using UTC bounds (`date = 2025-01-15`) fails to find the link because the database already labeled it as `Jan 16`.
- The visibility gap is **5.5 hours**, and because of the half-hour offset (`:30`), any hourly bucketed aggregation (`DATE_TRUNC('hour')`) is completely misaligned with standard UTC hour boundaries.

### 3. Server in a Daylight Saving Time (DST) Timezone (e.g., US Eastern)
- In US Eastern, standard time is **EST (UTC-5)** in winter, and daylight saving time is **EDT (UTC-4)** in summer.
- **Bi-annual Shift**:
  - In winter (EST), the midnight gap lasts **5 hours** (from 00:00 UTC to 05:00 UTC).
  - In summer (EDT), the midnight gap shrinks to **4 hours** (from 00:00 UTC to 04:00 UTC).
- **The "Fall Back" Catastrophe**: On the night clocks fall back from 2:00 AM to 1:00 AM, the local hour from 1:00 to 2:00 repeats twice. Any naive query relying on local timestamps will produce duplicate entries, inverted sort orders, or broken delta calculations for 60 minutes.

---

## Question 3: The Watchdog Log to Catch Timezone Defects Immediately

### Proposed Watchdog Log Entry
Place a post-write verification log in the database persistence adapter immediately after row insertion:

```json
{
  "timestamp": "2025-01-15T23:58:00.012Z",
  "level": "warn",
  "event": "temporal_boundary_skew_detected",
  "req_id": "r-101",
  "app_utc_time": "2025-01-15T23:58:00.000Z",
  "db_stored_time": "2025-01-15T18:58:00.000",
  "skew_minutes": -300,
  "alert": "Database stored timestamp deviates from UTC by -300 minutes; timezone normalization missing."
}
```

### Placement & Implementation
- **Location**: In `links.service.ts` / `prisma.service.ts` right after `prisma.link.create()`.
- **Logic**:
  ```typescript
  const skewMillis = Math.abs(link.createdAt.getTime() - appWriteInstant.getTime());
  if (skewMillis >= 60 * 1000) { // Skew greater than 1 minute indicates clock drift or timezone offset
    logger.warn({
      event: 'temporal_boundary_skew_detected',
      app_utc_time: appWriteInstant.toISOString(),
      db_stored_time: link.createdAt.toISOString(),
      skew_minutes: Math.round(skewMillis / 60000),
    }, 'Watchdog');
  }
  ```
- **Why this is powerful**: The very first link created under a non-UTC database configuration immediately fires a `WARN` alert naming the exact minute offset (-300 for EST, +330 for IST), pinpointing the root cause on day one before any customer reaches midnight.
