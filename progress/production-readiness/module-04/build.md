# Module 04: Observability - Implementation Record

## Overview
Implemented end-to-end observability across the three pillars:
1. **Structured Logging:** Implemented hybrid logging via `StructuredLoggerService` with strict ISO 8601 timestamps, log level severity, `service_name`, `request_id` correlation via `AsyncLocalStorage`, and human-friendly formatting in development vs structured NDJSON in staging/production.
2. **Application Metrics:** Integrated `prom-client` into `MetricsService`, exposing `GET /metrics` with Prometheus text format. Instrumented all routes with `http_requests_total`, `http_request_duration_seconds` (histogram), and `active_connections` (gauge).
3. **Alert Definitions:** Engineered production-grade Prometheus alerting rules (`infra/prometheus-alerts.yml`) with sustained evaluation windows (`for: 2m`) to prevent alert fatigue.

---

## Architecture & Implementation Details

### 1. Structured Logging (`src/common/logging/structured-logger.service.ts`)
- Standardized core telemetry fields on every log line:
  - `timestamp`: ISO 8601 UTC timestamp.
  - `level`: `info`, `warn`, `error`, `debug`.
  - `message`: Descriptive event summary.
  - `service_name`: `"url-shortener"`.
  - `request_id`: Extracted from request context via `RequestIdMiddleware` and propagated through `AsyncLocalStorage`.
- Hybrid mode:
  - Development: Clean, colorized terminal output for developer ergonomics.
  - Staging/Production: Compact NDJSON for automated ingest by Logstash, Datadog, or Grafana Loki.

### 2. Prometheus Metrics (`src/metrics/metrics.service.ts` & `src/metrics/metrics.middleware.ts`)
- Exposed open standard `GET /metrics` (`Content-Type: text/plain; version=0.0.4; charset=utf-8`).
- Key RED method metrics tracked:
  - **Rate & Error:** `http_requests_total{method, path, status}` (Counter).
  - **Duration:** `http_request_duration_seconds_bucket{method, path, status, le}` (Histogram with percentile buckets).
  - **Gauges:** `active_connections` (in-flight request tracking) and `urls_total`.
  - **System Metrics:** Default process and runtime memory/CPU utilization (`collectDefaultMetrics`).

### 3. Production Alert Definitions (`infra/prometheus-alerts.yml`)
- **Alert 1: `HighErrorRate` (Critical)**
  - Fires when 5xx errors exceed 5% of total request volume over a 5-minute rolling window for at least 2 minutes.
- **Alert 2: `HighLatency` (Warning)**
  - Fires when p95 response time exceeds 2.0 seconds over 5 minutes for at least 3 minutes.
- **Alert 3: `ServiceDown` (Critical)**
  - Fires when Prometheus scraper cannot reach `up == 0` for more than 1 minute.
