# Production Readiness: Product Scenario Selection

**Selected Scenario:** Option C — API Gateway (`apigw`)
**Alignment:** Matches the high-throughput, latency-sensitive requirements of the URL Shortener & Real-Time Analytics Platform.
**Core Production Constraints:**
- Sub-10ms P99 latency overhead for edge request routing and proxying.
- Edge rate limiting, auth guardrails, and request filtering.
- Upstream health checks with circuit breaking and automatic failover.
- Resilient zero-downtime rolling deploys and rapid rollback capabilities.
- Non-blocking telemetry and observability under high load.
