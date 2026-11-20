# Module 04: Observability - Break Analysis

## Executive Summary
An exhaustive failure mode analysis was conducted on the observability architecture, diagnosing three critical real-world anti-patterns:
1. **The Silent Failure:** Inconsistent telemetry where error metrics increment while error logs are swallowed.
2. **The Cardinality Bomb:** Metric storage explosion caused by embedding high-cardinality labels in Prometheus metrics.
3. **The Missing Request ID:** Loss of end-to-end transaction correlation across async execution boundaries.

---

## Detailed Diagnosis

### 1. Scenario 1: The Silent Failure (Pillar Disconnect)
- **Symptom:** Ingress client receives HTTP 500; Prometheus metric `http_requests_total{status="500"}` increments; however, zero error lines appear in log streams.
- **Root Cause:**
  - An exception handler or controller catches an exception and returns a 500 status code directly without forwarding the exception to `logger.error()`, or swallows it in a silent `catch {}` block.
- **Impact:**
  - On-call engineers are paged by `HighErrorRate` alerts, but when searching logs by timestamp or route, find no error stack trace or failure context.
- **Engineering Principle:**
  - **Symmetric Telemetry:** Every HTTP 5xx response MUST correspond to an accompanying structured error log containing `level: "error"`, the failure message, stack trace, and the associated `request_id`.

---

### 2. Scenario 2: The Cardinality Bomb (Dimensional Explosion)
- **Symptom:** Memory utilization of the service and Prometheus server climbs monotonically; `GET /metrics` latency spikes; scrape intervals time out; Prometheus crashes with Out-Of-Memory (OOM).
- **Root Cause:**
  - Injecting high-cardinality values (e.g., `user_id`, `request_id`, raw dynamic URL paths like `/links/4f8b2a`, or client IP addresses) as Prometheus metric labels.
- **Mathematical Impact:**
  - $N_{\text{series}} = N_{\text{methods}} \times N_{\text{routes}} \times N_{\text{statuses}} \times N_{\text{users}}$.
  - A label with 100,000 distinct users turns 20 basic metric combinations into $2,000,000$ independent in-memory time series.
- **Engineering Principle:**
  - Metrics are for **aggregate trends** over bounded, low-cardinality dimensions (HTTP method, normalized route template, status code).
  - High-cardinality, transaction-specific identifiers belong exclusively in **logs** and **distributed traces**.

---

### 3. Scenario 3: The Missing Request ID (Context Severance)
- **Symptom:** Log entries display `"request_id": null` or generate disconnected IDs across nested function calls.
- **Root Cause:**
  - Middleware failure, lost context during unhandled asynchronous hops (missing `AsyncLocalStorage` or lost thread context), or failing to extract incoming `X-Request-ID` headers.
- **Impact:**
  - System logs become disjointed fragments. An engineer investigating a failed request cannot trace the entry HTTP access log to the downstream database query log or the error exception.
- **Engineering Principle:**
  - Correlation IDs must be extracted or generated at the very edge of ingress, bound to request context via `AsyncLocalStorage`, and automatically injected into all downstream loggers, database clients, and outgoing network calls.
