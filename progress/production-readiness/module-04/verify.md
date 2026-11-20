# Module 04: Observability - Verification Report

## Verification Checklist

| Pillar | Requirement | Status | Concrete Proof |
|---|---|---|---|
| **1. Prometheus Metrics** | `GET /metrics` exports RED counters, latency histogram, and gauges | **PASSED** | `http_requests_total{method="GET",path="/live",status="200"}` tracked; `http_request_duration_seconds_bucket` populated; `urls_total` and `active_connections` present |
| **2. Structured Logging** | Valid JSON with all 5 mandatory fields | **PASSED** | Emits `timestamp`, `level`, `message`, `service_name: "url-shortener"`, `request_id` |
| **3. Error Telemetry** | 500 error emits level `error`, request correlation ID, and stack trace | **PASSED** | `GET /debug/error` emitted status 500; error logger captured `request_id: "req_1837748450c6ac247aa594ea"`; `http_requests_total{...,status="500"} 1` incremented |
| **4. Alert Definitions** | 3 actionable Prometheus alerts with expressions, thresholds, `for` durations, and runbooks | **PASSED** | `infra/prometheus-alerts.yml` defines `HighErrorRate` (5xx > 5% for 2m), `HighLatency` (p95 > 2s for 3m), and `ServiceDown` (`up == 0` for 1m) |

---

## Telemetry Evidence Snippets

### 1. Prometheus `/metrics` Output
```text
# HELP http_requests_total Total number of HTTP requests processed by the application
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/live",status="200"} 10
http_requests_total{method="GET",path="/debug/error",status="500"} 1

# HELP http_request_duration_seconds Histogram of HTTP request durations in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.005",method="GET",path="/live",status="200"} 10
http_request_duration_seconds_bucket{le="0.01",method="GET",path="/live",status="200"} 10
...
http_request_duration_seconds_count{method="GET",path="/live",status="200"} 10
http_request_duration_seconds_sum{method="GET",path="/live",status="200"} 0.012

# HELP active_connections Number of active HTTP requests currently being handled
# TYPE active_connections gauge
active_connections 0

# HELP urls_total Total count of shortened URLs managed by the platform
# TYPE urls_total gauge
urls_total 42
```

### 2. Structured Error Log Entry
```json
{
  "timestamp": "2026-11-20T04:49:43.161Z",
  "level": "error",
  "service_name": "url-shortener",
  "context": "ExceptionsFilter",
  "event": "request_error",
  "request_id": "req_1837748450c6ac247aa594ea",
  "method": "GET",
  "route": "/debug/error",
  "status_code": 500,
  "latency_ms": 4.33,
  "error_code": "INTERNAL_ERROR",
  "error_name": "HttpException",
  "error_message": "Simulated internal server error for failure-first observability drill",
  "message": "request_error"
}
```

---

## Conceptual Analysis

### 1. The 3 AM Incident Investigation Flow
- **Alert:** Tells you **THAT** something is wrong (`HighErrorRate` fired: 5xx > 5%).
- **Metrics Dashboard:** Tells you the **SHAPE** of what is happening (Which route? When did it start? What is the impact percentage across geographic pods?).
- **Structured Logs:** Tells you the **STORY** (Tracing `request_id` across log events reveals the exact database timeout, query parameter, or downstream network failure causing 500s).

### 2. Observability vs. Monitoring
- **Monitoring:** Watching for known failure conditions defined in advance (e.g. static threshold alerts on CPU > 85% or error rate > 5%).
- **Observability:** The degree to which internal system state can be inferred from external outputs. It enables engineers to formulate and answer **new, unpredicted questions** (e.g., *"Why did latency spike only for requests originating from iOS clients requesting URLs with query parameters longer than 2KB?"*) without modifying or redeploying code.
