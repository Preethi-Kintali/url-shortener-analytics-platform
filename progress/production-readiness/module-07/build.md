# Module 07: Runbooks & Operational Docs - Build Report

## 1. Chunk 1: Service Overview Document
- **Location:** `docs/service-overview.md` and `progress/production-readiness/module-07/service-overview.md`.
- **Core Sections Completed:**
  - **Purpose:** Concise two-sentence operational definition: URL Shortener & Analytics platform providing low-latency redirection with singleflight caching, collision-resistant Base62 generation, authenticated link management, asynchronous analytics streaming, and Prometheus telemetry.
  - **Dependencies Table:** Documents PostgreSQL, Redis, BullMQ worker, and Docker host networking, explicitly mapping the Module 06 fallbacks (circuit breaker 503s on uncached reads, database fallback on Redis misses, asynchronous decoupled click tracking).
  - **Endpoints:** Details operational probes (`/live`, `/ready`, `/metrics`) and domain endpoints (`/auth/login`, `/links`, `/r/:code`, `/analytics/:code`).
  - **Configuration:** Classifies environment variables into safe runtime changes (`LOG_LEVEL`, `CIRCUIT_RESET_TIMEOUT_MS`) vs restart-required changes (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `PORT`).
  - **Deploy & Rollback:** Fully copy-pasteable PowerShell / Docker commands utilizing immutable commit SHA image tagging (`myservice:$COMMIT_SHA`).
  - **Ownership & Escalation:** Establishes `#ops-url-shortener` channel, on-call paging contacts, and 5/10/20-minute SLA escalation rules.

---

## 2. Chunk 2: Three Incident Runbooks
- **Location:** `docs/runbooks.md` and `progress/production-readiness/module-07/runbooks.md`.
- **Authored Runbooks:**
  1. **Runbook 1: PostgreSQL Connection Pool Exhaustion & Outage (`HighErrorRate` / `DatabaseDown`):**
     - Primary signal: `/ready` probe returns HTTP 503 `{"checks":{"database":"disconnected"}}`.
     - Diagnosis: Inspects container logs for `PrismaClientInitializationError` and `circuit_opened`; checks container status with exact expected strings for both problem and healthy states.
     - Fix: Non-destructive restart of `upsk-sdf-postgres` container; socket verification via `Test-NetConnection`.
     - Verification: Deep `/ready` curl probe and 2-minute cooldown check.
  2. **Runbook 2: Redis Partition & Cache Layer Degradation (`HighLatency` / `RedisUnavailable`):**
     - Primary signal: P95 redirect latency spikes from <10ms to >80ms; logs show `redis_client_error`.
     - Diagnosis: Inspects Redis client logs and container status.
     - Fix: Restarts `bootcamp-redis`; verifies connectivity with `redis-cli ping` (expected `PONG`).
     - Verification: Validates `redis_connected` log event and sub-20ms redirect response times.
  3. **Runbook 3: High Latency & Cascading Circuit Breaker Flapping (`HighLatency` / `CircuitBreakerOpen`):**
     - Primary signal: Prometheus `http_request_duration_seconds` bucket saturation; alternating `circuit_opened` and `circuit_half_open` logs.
     - Diagnosis: Checks active PostgreSQL query durations in `pg_stat_activity`.
     - Fix: Terminates stalled backend queries exceeding 5s; clears corrupted cache state via `redis-cli FLUSHDB`.
     - Verification: Drains connection pool to $\le 3$ active queries; verifies `/live` latency returns to $<0.010\text{s}$.

---

## 3. Chunk 3: Empirical Runbook Drill Execution
- **Script:** `test-runbook-drill.js`.
- **Scenario:** Stopped PostgreSQL container (`upsk-sdf-postgres`), executed Runbook 1 diagnosis step, confirmed output matched documented failure state (`Exited`), executed documented fix command (`docker start upsk-sdf-postgres`), and verified container returned to `Up` state.
- **Discrepancies:** **0**. Zero placeholders were required; all commands executed verbatim.
