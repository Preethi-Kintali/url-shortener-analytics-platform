# Module 05: Failure Mode Analysis - Architectural Decision

## 1. Default Failure Stance Decision
- **Selected Choice:** Option B – Fail-Open (`fail_open`)
- **Reasoning:**
  For the URL Shortener & Real-Time Analytics Platform, the primary business priority is ensuring link redirection remains continuously available even when secondary dependencies experience temporary degradation. If Redis or BullMQ encounters transient downtime or latency spikes, user redirect traffic must not be blocked.

## 2. Dependency-Specific Failure Policy Matrix
To prevent security compromises or data corruption while maximizing uptime, the default `fail_open` stance is strictly partitioned across dependencies:
- **Authentication & Security Checks (Prisma / JWT):** **Fail-Closed.** Requests without valid, verified credentials or with broken database authentication must be rejected immediately (HTTP 401/403) to prevent unauthorized access.
- **Primary Database Writes (PostgreSQL):** **Fail-Closed.** Creating new links or mutating account state must fail closed (HTTP 503 / `DATABASE_UNAVAILABLE`) to prevent silent data loss or phantom records.
- **L1 Read Cache (Redis):** **Fail-Open.** When Redis is unreachable or times out, redirect lookups fail open by bypassing the cache and querying PostgreSQL directly.
- **Background Event Tracking (BullMQ / Analytics Queue):** **Fail-Open.** When the job queue is unavailable, link redirects proceed normally without failing user requests. Analytics events are buffered locally or gracefully dropped, preserving core redirection throughput.
