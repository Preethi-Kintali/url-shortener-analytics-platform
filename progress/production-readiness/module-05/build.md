# Module 05: Failure Mode Analysis - Artifact & Drill Record

## Chunk 1: External Dependency Inventory

| Dependency | Connection Method | Configured Timeout | Retry Behavior | Blast Radius & Operational Notes |
|---|---|---|---|---|
| **PostgreSQL** | TCP connection pool via Prisma Client | `connect_timeout=5s`, query pool timeout `10s` | Connection retry with exponential backoff on startup; pool timeout on query deadlock | Entire platform data persistence; unhandled timeouts lead to pool exhaustion |
| **Redis Cache** | TCP socket via `ioredis` | `connectTimeout: 5000ms`, `commandTimeout: 2000ms` | Built-in reconnect strategy (max 10 retries with jitter) | L1 link redirection cache; failure spikes DB load |
| **BullMQ Queue** | Redis pub/sub & stream | `maxRetriesPerRequest: 3`, worker stall timeout `30s` | Exponential backoff for job attempts (max 5 retries) | Background analytics processing; isolated from synchronous redirect path |
| **File System** | Local OS system calls (`fs`) | N/A (synchronous/async node kernel calls) | None (fails fast on `ENOSPC`) | App logs to stdout/stderr; temp directory writes |
| **DNS Resolver** | OS glibc / libc UDP/TCP resolver | Default OS timeout (`5s`) | Handled by host resolver | Resolves managed database & Redis hostnames; failure breaks all outbound network sockets |
| **Node.js Runtime** | In-process V8 engine & libuv event loop | N/A | Process exit on uncaught exception / unhandled rejection | Memory OOM, CPU saturation, event loop lag stalling HTTP requests |

---

## Chunk 2: Comprehensive Failure Mode Table

| Dependency | Failure Mode | Probability | User Impact | Current Handling | Desired Handling |
|---|---|---|---|---|---|
| **Database** | Connection refused (`ECONNREFUSED` / down) | Medium | Reads and writes fail; new links cannot be created | `/ready` probe returns HTTP 503; API endpoints return HTTP 503 `DATABASE_UNAVAILABLE` | Return structured 503, trip circuit breaker, route traffic away via readiness probe |
| **Database** | Slow queries / lock contention | High | Requests hang, latency spikes, clients timeout | Queries hold connection pool slots until client timeout | Strict 3-second query timeout, return HTTP 504, log slow queries with parameters |
| **Cache (Redis)** | Redis down / connection reset | Medium | Cache lookups fail; all redirect traffic drops to PostgreSQL | Uncaught redis error if unhandled | Fail open: bypass Redis, query PostgreSQL directly, increment degraded mode metric |
| **Cache (Redis)** | Stale / corrupted cache keys | High | Users redirected to outdated target URLs | Served until TTL expires | Enforce maximum TTL (e.g. 300s), cache-aside invalidation on link updates, key versioning |
| **BullMQ Queue** | Queue stall / Redis disconnect | Medium | Analytics events not persisted to disk | Job enqueueing throws error | Fail open: drop or buffer analytics in memory, allow redirect to succeed with HTTP 302 |
| **External APIs** | Third-party service down / slow | Medium-High | Downstream integration points freeze | Unbounded request wait | 2-second timeout, circuit breaker opening after 5 consecutive failures, fallback stub |
| **File System** | Disk full (`ENOSPC`) | Low-Medium | Log writes fail, process crashes on temp write | Silent failure or container exit | Centralized stdout streaming (Docker json-file with max-size rotation), container disk alerts |
| **Runtime (OOM)** | Memory leak / heap exhaustion | Low-Medium | Process terminated abruptly by OS kernel OOM killer | In-flight requests dropped, container restarts | Set container memory limits (`--memory 512m`), monitor heap usage via Prometheus gauge |
| **Network** | Network partition between app & DB | Low-Medium | Partial availability: local cache works, DB queries fail | Ingress hangs waiting for TCP ACK | Aggressive socket connect timeouts (2s), keepalive probes, failover readiness |
| **Database** | Connection pool exhaustion | Medium | New queries rejected immediately (`Timed out waiting for connection`) | Returns 500 error | Bounded pool size (e.g. 20), query timeouts, rate limiting on ingress routes |
| **System Clock** | NTP drift / Clock skew | Low | JWT validation fails; tokens expire prematurely | Throws `JsonWebTokenError` / `TokenExpiredError` (HTTP 401) | Run host NTP daemon synchronization, allow 30s clock skew leeway in JWT verifier |

---

## Chunk 3: Failure Simulation Drill Records

| Simulation Test | Injected Condition | Expected Behavior | Actual Observed Behavior | Gap / Action Item |
|---|---|---|---|---|
| **1. Database Down** | Started API pointing to dead port 5433 | `GET /ready` returns 503; process stays alive | `GET /ready` returned `503 {"ok":false,"status":"unready","db":"unreachable","redis":"ok"}`. Process remained running. | None. Readiness probe properly shields cluster from traffic. |
| **2. Low Timeout (1ms)** | Injected 1ms `AbortSignal.timeout(1)` on network request | Request fails fast with timeout error | Request aborted in 62ms with `TypeError: fetch failed` without hanging process | Ensure all outbound HTTP clients wrap timeouts into clean `GatewayTimeoutException` (504). |
