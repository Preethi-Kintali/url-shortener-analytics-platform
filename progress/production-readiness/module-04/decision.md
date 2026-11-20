# Module 04: Observability - Architectural Decisions

## Decision 1: Structured Log Format
- **Selected Choice:** Option B – Hybrid (`hybrid`)
- **Reasoning:**
  I choose hybrid logging because human-readable, colorized logs make local debugging significantly faster and clearer in developer terminals, while structured NDJSON logs in staging and production support automated log aggregation, parsing, indexing, and search (e.g. Datadog, Loki, CloudWatch). The logging schema and core fields (timestamp, level, message, request_id, route, latency_ms) remain strictly consistent across environments to prevent format drift.

---

## Decision 2: Metrics Architecture
- **Selected Choice:** Option A – Pull-based Prometheus (`pull_prometheus`)
- **Reasoning:**
  I choose Prometheus because it is the industry standard for monitoring containerized, long-running web services and microservices. Exposing a standardized `GET /metrics` endpoint allows a central Prometheus scraper to periodically collect RED method metrics (Request Rate, Error Rate, and Latency Duration) along with system resource utilization. It decouples metric aggregation from application processing and provides seamless integration with Grafana for dashboards and PagerDuty/Slack for threshold alerting.
