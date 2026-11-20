# Module 08 — Step 4: Verification Report (Deploy & Verify Capstone)

## Executive Summary
This document provides empirical verification and architectural analysis for the automated deployment and rollback pipeline in the URL Shortener & Analytics Platform.

---

## 1. Proof Checklist Verification

### Checklist 1: Public URL Accessibility
- **Liveness Endpoint (`GET /live`):**
  - Status: `HTTP 200 OK`
  - Body: `{"ok": true}`
  - Verified: Lightweight, zero backing dependency queries.
- **Readiness Endpoint (`GET /ready`):**
  - Status: `HTTP 200 OK`
  - Body:
    ```json
    {
      "ok": true,
      "checks": {
        "database": "connected",
        "cache": "connected",
        "uptime_seconds": 72
      },
      "status": "ready",
      "db": "ok",
      "redis": "ok"
    }
    ```

### Checklist 2: Dependency Verification Detail
- The `/ready` probe tests both PostgreSQL and Redis connectivity with an aggressive 2-second timeout boundary (`Promise.race` with timer cleanup).
- Returns explicit granular dependency states (`database: connected`, `cache: connected`, `uptime_seconds`) rather than an ambiguous boolean.

### Checklist 3: Prometheus Metrics Validation
- **Metrics Endpoint (`GET /metrics`):**
  - Status: `HTTP 200 OK`
  - Payload size: 10,917 bytes
  - Standard Prometheus metrics present: `http_requests_total`, `http_request_duration_seconds`, `node_process_cpu_user_seconds_total`, and `process_resident_memory_bytes`.

### Checklist 4: Gated Broken Deployment
- Candidate container deployed with corrupted `DATABASE_URL` (`wrong_db:5499`).
- `GET /live`: `HTTP 200` (Process running).
- `GET /ready`: `HTTP 503 Service Unavailable` with payload:
  ```json
  {
    "ok": false,
    "checks": {
      "database": "disconnected",
      "cache": "connected",
      "uptime_seconds": 3
    },
    "status": "unready",
    "db": "unreachable",
    "redis": "ok"
  }
  ```
- **Result:** Deployment gate halted rollout immediately. Zero user traffic was routed to the broken instance.

### Checklist 5: Rollback MTTR < 2 Minutes
- Automated rollback initiated to known-good image (`myservice:2fb26c6`).
- **Measured Rollback Time:** **4.28 seconds** (SLA target: <120 seconds).
- Post-rollback service verified serving HTTP 200 on `/live`, `/ready`, and `/metrics`.

---

## 2. Conceptual Questions & Operational Defense

### 1. Full Pipeline Trace
When a commit is pushed or merged into `main`, the deployment pipeline follows this 10-step sequence:
1. **Trigger:** GitHub Actions starts the workflow on push to `main`.
2. **Lint & Typecheck:** `npx tsc --noEmit` and linter identify static typing and syntax defects. (Catches type mismatch, unresolved symbols; halts before build).
3. **Automated Test Suite:** Unit and integration tests run against PostgreSQL and Redis service containers. (Catches business logic and contract regressions; blocks deployment if tests fail).
4. **Container Build:** Multi-stage Docker build compiles TypeScript, prunes devDependencies, and packages runtime artifacts. (Catches compilation errors, missing native binaries, dependency resolution failures).
5. **Immutable Image Tagging:** The image is tagged with the exact Git commit SHA (`myservice:${{ github.sha }}`) to guarantee end-to-end provenance.
6. **Rolling Deployment:** Platform starts candidate container alongside existing healthy instances.
7. **Readiness Verification Loop:** Pipeline executes a 30-attempt polling loop against candidate `/ready`. (Catches DB connection failures, misconfigured environment variables, migration mismatches).
8. **Post-Deploy Smoke Tests:** Evaluates `/live`, `/ready`, and `/metrics` against the public endpoint.
9. **Automated Rollback:** If readiness or smoke tests fail, the pipeline immediately rolls back to the prior known-good SHA image.
10. **Traffic Serving:** Ingress load balancer shifts traffic to the verified instance and terminates older instances gracefully.

### 2. Monday Morning Health Audit
When auditing a Friday 4:00 PM release on Monday morning, we inspect specific quantitative metrics, alert histories, and structured logs rather than vague dashboards:
- **HTTP Error Rate (`http_requests_total`):** Compute rate of `status_code=~"5.."` divided by total request rate. Investigate any sustained error rate above the 5% critical threshold.
- **Request Latency (`http_request_duration_seconds`):** Examine p95 and p99 latency histograms and compare against pre-deployment baselines.
- **Traffic Volume & Pattern:** Compare weekend request rate against historical weekend curves to verify traffic was not silently blackholed.
- **Process Resource Consumption:** Query `process_resident_memory_bytes` and `node_process_cpu_user_seconds_total` across the 64-hour weekend window to detect memory creep or CPU saturation.
- **PostgreSQL Connection Pool & Queries:** Check active connections, query latencies, pool wait times, and timeout errors.
- **Redis Health & Cache Hit Ratio:** Check command latencies, connection disconnects, and fallback rates.
- **Structured Log Anomalies:** Query Elasticsearch/Loki for `level: "error"`, `event: "db_query_failed"`, `event: "circuit_breaker_opened"`, and unhandled exceptions.
- **Version Attestation:** Run container inspect to confirm 100% of running replicas are executing the expected Git commit SHA.

### 3. Silent Degradation & Memory Leaks
- **The Core Risk:** PostgreSQL and Redis remain healthy, so `/ready` returns HTTP 200 even though the Node.js process is leaking memory and approaching an Out-Of-Memory (OOM) kill.
- **Detection Architecture:**
  - **Memory Saturation Alerting:** Alert on `process_resident_memory_bytes` exceeding 80% of container limit or showing continuous monotonic growth over a 60-minute window without plateau.
  - **Node.js Runtime Metrics:** Track Garbage Collection pause duration and frequency (`nodejs_gc_duration_seconds`) and Event Loop Lag (`nodejs_eventloop_lag_seconds`).
  - **Latency Creep Alerts:** Alert when p99 latency degrades by >50% relative to baseline.
- **Remediation & Guardrails:**
  - Keep `/live` lightweight and dependency-independent to prevent cascading boot loops.
  - In Kubernetes/orchestrator deployments, configure memory-based pod eviction thresholds with rolling restart.
  - When memory or event loop saturation correlates with a release, the deployment controller automatically triggers an emergency rollback to the previous known-good commit SHA.
  - Infrastructure health, backing dependency health, and application runtime performance represent three distinct operational planes: all three must be monitored and alerted independently.
