# Module 06 CONTEXT: System Boundary & Multi-Layer Dependency Mapping

## 1. Architectural Handshake & Boundary Analysis

Multi-layer bugs reside in the spaces between decoupled services rather than inside individual modules. While each subsystem passes unit tests in isolation, undocumented and unverified assumptions across service boundaries create the conditions for systemic cascading failure.

```
┌─────────────────┐      HTTP / TCP      ┌─────────────────┐
│                 ├─────────────────────►│   Redis Cache   │
│                 │◄─────────────────────┤                 │
│                 │   (Boundary 1: Freshness & Fallback)   │
│                 │                                        │
│                 │      Pool / TCP      ┌─────────────────┐
│   API Service   ├─────────────────────►│   PostgreSQL    │
│  (HTTP Ingress) │◄─────────────────────┤   (Primary DB)  │
│                 │   (Boundary 2: Resource Contention)    │
│                 │                                        │
│                 │      Enqueue         ┌─────────────────┐
│                 ├─────────────────────►│   Job Queue /   │
│                 │                      │ Background Wkr  │
└─────────────────┘                      └────────┬────────┘
                                                  │ Shared Pool
                                                  ▼
                                         ┌─────────────────┐
                                         │   PostgreSQL    │
                                         │ (Resource Clash)│
                                         └─────────────────┘
```

---

## 2. The Three Critical System Boundaries

### Boundary 1: API HTTP Service $\leftrightarrow$ Redis Cache
- **Handoff Mechanism**: The API queries Redis by short-code key before querying PostgreSQL; on cache misses or updates, it populates the cache.
- **Implicit Assumptions**:
  - The API assumes Redis will respond sub-millisecond and that cached entries reflect current database state.
  - The API assumes cache invalidation events execute synchronously when links are modified or deleted.
- **Failure Mode & Vulnerability**:
  - Stale cache: if link records are deleted or updated directly in the database (or if an invalidation message is dropped), Redis serves stale or ghost links without warning.
  - Redis outage / partition: without circuit breakers or timeout thresholds, slow Redis calls block the Node.js event loop, degrading the entire HTTP ingress.
- **Enforcement Mechanisms**: Explicit TTLs (Time-To-Live), cache-aside invalidation contracts, and graceful timeouts with fallback to PostgreSQL.

---

### Boundary 2: API HTTP Service $\leftrightarrow$ PostgreSQL Database
- **Handoff Mechanism**: The API acquires a connection from a shared connection pool via Prisma/ORM, executes queries or transactions, and returns the connection to the pool.
- **Implicit Assumptions**:
  - The API assumes a connection slot is immediately available in the pool.
  - The API assumes database queries return within reasonable SLA limits (e.g. < 50ms) and that connections are never held indefinitely.
- **Failure Mode & Vulnerability**:
  - Connection Pool Exhaustion: If queries hang or if connection releases fail on unhandled exception branches, the pool saturates. New API requests queue up indefinitely, resulting in total API freeze.
- **Enforcement Mechanisms**: Strict connection pool sizing, acquisition timeouts (`connection_timeout`), query execution deadlines (`statement_timeout`), and RAII / `finally`-block connection releases.

---

### Boundary 3: API HTTP Service $\leftrightarrow$ Queue / Background Worker
- **Handoff Mechanism**: The API enqueues asynchronous tasks (e.g., analytics aggregation, webhook delivery, link verification) into a message broker/queue, which workers consume.
- **Implicit Assumptions**:
  - The API assumes that jobs placed in the queue are durably persisted and eventually executed.
  - The worker assumes incoming payloads conform to expected schemas and that failed jobs can be retried indefinitely.
- **Failure Mode & Vulnerability (The Retry Storm & Cascading Failure)**:
  - If a background job fails due to an external error (e.g. target endpoint down) and retries aggressively without exponential backoff or jitter, workers flood the system with retries.
  - If the background worker shares the same database connection pool or CPU resources as the user-facing API, the worker's retry storm monopolizes the database connections, starving the API and causing a full user-facing outage.
- **Enforcement Mechanisms**: Dead-letter queues (DLQ), strict maximum retry counts (`max_retries = 3`), exponential backoff with jitter, idempotent job execution, and isolated connection pools for background workers vs. API traffic.

---

## 3. Core Architectural Takeaways
1. **Components vs. Boundaries**: Bugs do not occur because a component failed its internal specification; they occur because contracts across boundaries were assumed rather than enforced.
2. **Cascading Failure Prevention**: Resource isolation (e.g. separate connection pools for API and workers) is the first line of defense against cross-tier failure contagion.
