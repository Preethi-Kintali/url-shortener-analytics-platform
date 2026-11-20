# Module 02 DECIDE: Production Logging Strategy

## Context & The Dilemma
In Step 2 of Module 02, we face a fundamental architectural tradeoff that divides engineering organizations:
- **Option A: Verbose by Default (`verbose_default`)** — Log everything at `DEBUG` level in production. Full visibility into every state transition, query, and cache lookup, at the cost of massive log volume, high cloud storage bills, and high signal-to-noise ratios.
- **Option B: Minimal by Default (`minimal_default`)** — Log only `WARN` and above in production. Keep logs lean, searchable, and low-cost, relying on dynamic elevation to `DEBUG` when diagnosing issues.

---

## Probing Questions Analysis

### 1. The Intermittent, Unreproducible Bug
*If a bug only appears once a week and cannot be reproduced on demand, which strategy catches it? What if you only find out about the bug two days after it last happened?*
- **Option A Advantage**: Option A guarantees that the telemetry from two days ago is already persisted in log storage. You can search by request ID or timestamp window and reconstruct the entire variable state leading up to the failure.
- **Option B Limitation**: Under Option B, if the bug only logged at `INFO` or `DEBUG` and did not throw an unhandled exception or trigger a `WARN`, the evidence was never recorded to disk and cannot be recovered retroactively.

### 2. High-Throughput Cost & Performance Math
*What is the cost of logging every request in a service handling 10,000 requests per second?*
- Traffic: $10{,}000\text{ requests/sec}$
- Log volume: $5\text{ log entries/request} \times 500\text{ bytes/line} = 25\text{ MB/sec}$
- Hourly throughput: $25\text{ MB/sec} \times 3600\text{ sec} = 90\text{ GB/hour}$
- Daily storage: $90\text{ GB/hour} \times 24 = 2{,}160\text{ GB/day} = 2.16\text{ TB/day}$
- Monthly storage: $\approx 64.8\text{ TB/month}$
- Financial impact: At \$0.50/GB ingestion + 30-day retention in Datadog/CloudWatch, log ingestion alone costs **\$1,080/day (\$32,400/month)**—often far exceeding the compute infrastructure bill.
- System impact: Saturates disk I/O, consumes Node.js event loop cycles serializing JSON, and degrades query search latencies in Elasticsearch/Loki.

### 3. Dynamic Log Level Configuration
*Can you change log levels without redeploying your application? Should you be able to? What architectural choice makes that possible?*
- **Yes, absolutely**: Applications should decouple logging configuration from source code deployments.
- **Architectural Patterns**:
  1. *Admin Control Route*: Authenticated internal endpoint (`POST /admin/logging { "level": "debug", "duration_minutes": 15 }`) that updates an in-memory logger configuration atomically.
  2. *Distributed Config / Feature Flags*: Polling Redis, Consul, or LaunchDarkly for log level overrides per tenant or service instance.
  3. *Request-Header Injection (Contextual Debugging)*: Checking for an internal debug header (e.g., `X-Debug-Trace: true` with a shared secret) that elevates the logger to `DEBUG` exclusively for that single request lifecycle.

### 4. The Synthesis / Middle Ground
The ideal production stance is **Minimal/Standard by Default** paired with **Dynamic Request-Scoped Tracing**:
- Standard production runs at `INFO` or `WARN` for low noise and cost efficiency.
- Anomaly conditions (slow DB writes, retries, 4xx/5xx responses) are strictly emitted at `WARN` or `ERROR`.
- Targeted debugging allows engineers to flip to `DEBUG` for specific routes, users, or time-bounded windows without redeployment.

---

## Decision Record
We choose **Option B: Minimal by Default (`minimal_default`)**.

### Selected Rationale
For a high-throughput URL shortener platform like `linkops`, logging every redirect and cache check at `DEBUG` in production generates unmanageable log bloat (2.16 TB/day at scale), saturates disk I/O, and buries critical failures under millions of routine lines. We choose Option B (Minimal by Default) to ensure high signal density, rapid searchability, and bounded operational costs. To mitigate the risk of silent failures (such as the checkout incident where errors logged at INFO were ignored), we mandate strict log-level classification—ensuring all anomalies and business rule violations emit at `WARN` or `ERROR`—and implement runtime dynamic log level switching for targeted troubleshooting.
