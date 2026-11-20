# Module 05: Failure Mode Analysis - Verification Report

## Verification Checklist

| Verification Item | Requirement | Result | Concrete Evidence |
|---|---|---|---|
| **1. Enumerate Failure Modes** | At least 8 distinct failure modes documented | **PASSED** | 11 comprehensive failure modes analyzed across DB, Cache, Queue, Runtime, Network, and DNS |
| **2. Empirical Simulation** | At least 2 real failure modes empirically tested | **PASSED** | Simulated dead DB on port 5433 (`GET /ready` -> 503 unready) and 1ms timeout injection (`AbortSignal.timeout(1)` -> fast fail in 62ms) |
| **3. Remediation Delta** | Desired handling distinct from current default | **PASSED** | Replaced unbounded hangs with strict timeouts, fallback cache bypassing, and circuit breakers |
| **4. Classification of Failures** | Categorized into Transient vs. Permanent | **PASSED** | Defined distinct handling policies: retry with backoff for transient, fail-fast with zero retry for permanent |

---

## Risk Ranking: Top 3 Failure Modes ($\text{Risk} = \text{Probability} \times \text{Impact}$)

1. **Rank 1: Database Slow Queries & Connection Pool Exhaustion**
   - **Score:** High Probability $\times$ High Impact $\implies$ **Critical Risk**
   - **Why Fix First:** A slow database is far more dangerous than a dead database. A dead database fails fast in 2ms; a slow database holds connection pool slots open for 30 seconds, quickly exhausting all available sockets and causing the entire Node.js server to hang and stop answering health checks or unrelated endpoints.
   - **Remediation:** Strict 3-second query timeout, circuit breaker tripping on latency thresholds, and query performance budgets.

2. **Rank 2: Redis Cache Downtime (Thundering Herd Outage)**
   - **Score:** Medium Probability $\times$ High Impact $\implies$ **High Risk**
   - **Why Fix Second:** When Redis goes down, every redirect request bypasses the cache and hits PostgreSQL simultaneously. If redirect throughput is 2,000 req/sec, the database is instantly overwhelmed by a 10x traffic spike.
   - **Remediation:** Implement cache-aside fallback with a single-flight mutex / coalescing query mechanism and circuit breaker to prevent DB stampedes.

3. **Rank 3: DNS Resolution Failure**
   - **Score:** Low-Medium Probability $\times$ Critical Impact $\implies$ **High Risk**
   - **Why Fix Third:** Often completely overlooked because developers test with `localhost`. In cloud environments, if internal DNS resolvers degrade, hostnames (`postgres.internal`, `redis.internal`) fail to resolve, causing cryptic connection timeouts that bypass standard database retry loops.
   - **Remediation:** Internal IP caching or connection keep-alive pools.

---

## Transient vs. Permanent Failure Strategy

| Failure Type | Characteristics | Examples | Correct Operational Response |
|---|---|---|---|
| **Transient** | Self-healing, temporary network or contention blips | Micro-partitions, Redis failover, lock timeout during vacuum | **Retry with Exponential Backoff & Jitter.** Protects downstream services from thundering herds while allowing automatic recovery. |
| **Permanent** | Will never succeed without human or deployment intervention | Invalid DB credentials, schema column mismatch, malformed request body | **Fail Fast & Alert.** Do NOT retry. Retrying a permanent error wastes CPU, exhausts connection pools, and hammers broken endpoints. |
