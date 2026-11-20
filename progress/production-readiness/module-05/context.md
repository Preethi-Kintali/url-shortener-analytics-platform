# Module 05: Failure Mode Analysis - Context & Dependency Risk Mapping

## 1. Backing Dependency Outage Matrix (60-Second Complete Outage)

| Dependency | Direct Role | Impact if Completely Down for 60s | Failure Surface & Behavior |
|---|---|---|---|
| **PostgreSQL (Prisma)** | Persistent storage for users, URLs, audit logs | User auth, link creation, uncached link lookups fail | Returns HTTP 503 (`DATABASE_UNAVAILABLE`) or HTTP 500 via `AllExceptionsFilter`. Process remains alive without crashing. |
| **Redis (ioredis)** | L1 Cache for short code redirection | Cache hits fail; traffic fails over to PostgreSQL | If fallback is enabled, PostgreSQL absorbs 100% of read traffic (thundering herd risk). If unhandled, redirects throw connection errors. |
| **BullMQ Queue** | Background worker queue for async analytics processing | Asynchronous job enqueueing blocks or drops events | Analytics processing halts; if enqueueing is synchronous on the redirect path, redirect requests can stall unless decoupled. |
| **DNS / Ingress Network** | External name resolution and TLS termination | External clients receive `DNS_PROBE_FINISHED_NXDOMAIN` or connection timeouts | Container process is completely unaffected internally, but ingress traffic reaches zero. |

*Note:* JWT authentication is verified statelessly in-process via symmetric secret verification (`JWT_SECRET`), remaining fully functional during external identity network partitions.

---

## 2. "Down" vs. "Slow" Failure Dynamics
- **Down (Fast Failure):**
  - Connection is immediately refused (`ECONNREFUSED`) or resets quickly.
  - Connection pools fail fast; request threads are released within milliseconds.
  - Telemetry error rates spike immediately, triggering alerts rapidly.
- **Slow (Resource Exhaustion & Cascading Failure):**
  - A query or downstream call that usually takes 50ms suddenly takes 5,000ms.
  - Ingress requests remain open, holding HTTP sockets, file descriptors, and Node.js event-loop memory.
  - Database connection pools saturate completely (`pool exhaustion`); incoming requests queue up until memory runs out or client timeouts occur.
  - Slow dependencies are substantially **more dangerous** because they masquerade as working systems while stealthily starving the entire platform of finite resources.
- **Remediation Arsenal:**
  - Strict bounded client timeouts on every network call.
  - Circuit breakers tripping on latency percentiles.
  - Bulkheads isolating non-critical background analytics from critical link redirection.
  - Graceful degradation returning cached data or degraded 200/302 responses.
