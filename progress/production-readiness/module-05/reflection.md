# Module 05: Failure Mode Analysis - Reflection

## 1. Fail-Open vs. Fail-Closed in Practice
In my URL Shortener & Analytics Platform, I would apply different failure policies depending on the responsibility of each component:

**Fail-Closed:**
- Authentication and authorization must reject requests if security validation cannot be completed.
- PostgreSQL writes must fail if the database is unavailable because we cannot confirm whether the operation succeeded.
- Critical link creation and update operations must not proceed without authoritative database confirmation.

**Fail-Open:**
- Redis cache failures should fall back to PostgreSQL wherever possible.
- Non-critical analytics tracking should not block URL redirection.
- Background analytics jobs can be retried when the queue becomes available again.

An all-or-nothing policy is dangerous because fail-closed everywhere unnecessarily reduces availability, while fail-open everywhere can compromise security and data correctness. A dependency-specific approach provides a better balance.

---

## 2. Simulation Insights & Surprises
The most interesting observation was that an unreachable database did not necessarily crash the entire application process.

Instead, the readiness endpoint returned HTTP 503, indicating that the application was not ready to serve normal traffic, while the process remained alive. This showed the practical difference between liveness and readiness.

The 1ms timeout simulation also demonstrated that a request can be aborted quickly instead of waiting indefinitely for a dependency response.

A typical developer might assume that a database connection failure immediately crashes the application. However, with proper exception handling, timeouts, and health probes, the application can remain alive and report its degraded state clearly. Dependency failures should be contained rather than allowed to crash the entire service.

---

## 3. If I Could Only Protect Against One Failure Mode
I would prioritize **database connection pool exhaustion caused by slow or stalled database operations**.

This is dangerous because requests can hold database connections for longer than expected. As more requests arrive, the connection pool can become exhausted, causing even healthy API operations to wait or fail.

It creates a cascading failure:
1. Database queries become slow.
2. Connections remain occupied for longer.
3. New requests start waiting for available connections.
4. API latency and timeouts increase.
5. The entire application becomes less responsive.

I would protect against this using strict query and connection timeouts, connection pool limits, circuit breakers, bounded retries, and monitoring of active and waiting connections. Preventing resource exhaustion helps protect the availability of the entire system.
