# Module 06: Graceful Degradation & Circuit Breaking - Decisions

## Decision 1: Circuit Breaker Approach
- **Choice:** **Option A — Library-based Circuit Breaker (`opossum`)**
- **Rationale:**
  - Handling asynchronous concurrency, half-open probe timeouts, error percentage sliding windows, and recovery timers in custom state machines is notoriously prone to subtle race conditions and state leakage.
  - `opossum` is battle-tested in enterprise production environments, provides out-of-the-box event hooks for Prometheus metrics (`fire`, `reject`, `timeout`, `success`, `failure`, `open`, `close`, `halfOpen`), and integrates seamlessly with Node.js async/await paradigms.
  - Significantly reduces custom infrastructure maintenance while guaranteeing rock-solid circuit tripping and recovery semantics.

---

## Decision 2: Timeout Strategy
- **Choice:** **Option A — Aggressive Timeouts (500ms – 1s baseline)**
- **Rationale:**
  - Slow dependencies are far more lethal than dead dependencies because they monopolize TCP sockets, worker threads, and PostgreSQL connection pool slots, triggering cascading failures across the entire service.
  - Failing fast in <500ms allows the system to return graceful fallbacks (e.g. database fallback for Redis cache misses, or empty responses for non-critical features) before client connection buffers saturate.
  - **Tiered Timeout Customization:**
    - Redis cache lookups: Aggressive 250ms–500ms timeout (fall back directly to PostgreSQL).
    - PostgreSQL standard queries: 1,000ms timeout.
    - Background analytics jobs (BullMQ): Asynchronous queueing decoupled from the redirect critical path, allowing separate backoff retry policies.
