# Module 04: Observability - Fix & Remediation Report

## Summary of Fixes Applied
1. **Symmetric Telemetry (Eliminating Silent Failures):**
   - Verified that `AllExceptionsFilter` catches all unhandled exceptions and explicitly logs them through `StructuredLoggerService.error()` with `level: "error"`, `event: "request_error"`, stack traces, sanitized route paths, and HTTP status codes.
   - Guaranteed that whenever the client receives a 500 status and Prometheus increments `http_requests_total{status="500"}`, an accompanying error log entry is emitted with full forensic context.
2. **Cardinality Hardening (Guarding Against Explosions):**
   - Configured Prometheus labels in `MetricsService` strictly to low-cardinality dimensions: `method` (GET, POST, PUT, DELETE), `path` (normalized sanitized templates), and `status` (HTTP status code).
   - Prohibited dynamic high-cardinality variables (`user_id`, `request_id`, raw token parameters) from metric labels, keeping them confined to structured logs.
3. **Robust Request Correlation:**
   - Ensured `RequestIdMiddleware` executes via `AsyncLocalStorage.run()` on every route, guaranteeing that even during nested async operations, asynchronous database calls, and exception handlers, the same `request_id` is preserved and printed across all log entries.

---

## Pillar Verification Evidence

| Pillar | Verified Response | Evidence |
|---|---|---|
| **1. Logs** | Level `error` emitted with `request_id` and error details | `{"timestamp":"...","level":"error","service_name":"url-shortener","request_id":"req_1837748450c6ac247aa594ea","method":"GET","route":"/debug/error","status_code":500,"error_message":"Simulated internal server error..."}` |
| **2. Metrics** | Prometheus counter incremented | `http_requests_total{method="GET",path="/debug/error",status="500"} 1` |
| **3. Alerts** | Math and expression validated | `HighErrorRate` alert triggers when $\frac{\text{rate}(5xx)}{\text{rate}(\text{total})} > 0.05$ sustained for 2 minutes |
