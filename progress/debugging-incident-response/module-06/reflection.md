# Module 06 REFLECT: Multi-Layer Systems & Shared Resource Contention

## 1. Investigation Strategy Review
- **Vertical vs. Horizontal Tradeoffs**: Choosing Option B (vertical investigation) was highly effective for Bug #9, as tracing the lifecycle of a single short link across delete and redirect paths exposed the missing cache invalidation handshake between PostgreSQL and Redis.
- **The Disconnected Request Path Challenge**: However, for Bug #10, vertical tracing of an API request alone proved insufficient because the root cause was not in the API request path—it was in an asynchronous background queue worker that shared the same database connection pool.
- **Future Protocol**: When debugging multi-tier architectures, combine vertical tracing of the affected request with immediate horizontal cross-checks of shared bottleneck resources (database connection pools, Redis instance CPU/memory, queue depths, thread pools). This rapidly exposes resource contention between disjoint request flows.

## 2. Victim vs. Perpetrator Mentality (Bug #10)
- **The Pitfall of Profiling the Symptom**: When user-facing API requests hang or time out, teams intuitively profile the API service—inspecting route handlers, garbage collection, and event loop delays.
- **The Critical Shift**: The API in Bug #10 was completely healthy; it was merely starved of database connections because an unconstrained queue worker retried in a tight loop and saturated the shared connection pool.
- **Rule of Thumb**: When a component stops responding without throwing internal errors, do not ask "What is broken in this component?" Ask "What shared resource is this component waiting for, and who else has checked it out?" The component showing the symptom is frequently the victim, not the perpetrator.

## 3. Core Architectural Principles for Shared Resources
- **Bulkhead Isolation**: Partition shared resources so that a failure or runaway process in one subsystem cannot exhaust capacity needed by other subsystems (e.g. dedicated connection pools for background workers vs. user-facing APIs).
- **Disjoint Namespacing**: Enforce distinct, strictly segregated Redis key prefixes for distinct functional domains (e.g. `link:redirect:<code\>` vs. `analytics:dedup:<job_id\>`) to prevent cache invalidation from corrupting worker deduplication state.
- **Bounded Retries & Exponential Backoff**: Implement strict retry limits (`max_retries = 5`), exponential backoff delays with jitter, and dead-letter queue (DLQ) routing to eliminate retry storms.
- **Explicit Invalidation Contracts**: Maintain bidirectional consistency between primary datastores and secondary caches upon write and delete mutations.
- **Proactive Resource Telemetry**: Monitor connection pool utilization and wait queue depths rather than relying on trailing API response-time alarms.

## 4. Implicit Shared Resource in This Architecture
- **Identified Resource**: The PostgreSQL connection pool. Both the high-throughput HTTP API and the asynchronous analytics queue worker compete for the same finite pool of database connections.
- **Protective Safeguards**: Establish independent connection pools (e.g. 15 connections reserved for the API, 5 for background workers), enforce worker concurrency bounds, and alert on pool wait queues before customer requests time out.
