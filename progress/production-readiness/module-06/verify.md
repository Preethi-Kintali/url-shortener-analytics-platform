# Module 06: Graceful Degradation & Circuit Breaking - Verification Report

## 1. Functional Verification & Concrete Drill Evidence

| Requirement | Configured Parameter | Observed Drill Result | Status |
|---|---|---|---|
| **1. Explicit Timeouts** | Database: 1000ms (test: 300ms)<br>Redis: 500ms (`commandTimeout`) | Timed out cleanly in 309ms; emitted `dependency_timeout` log with request ID | **VERIFIED** |
| **2. Circuit Breaker Opening** | `volumeThreshold: 5`, `errorThresholdPercentage: 50%` | Breaker tripped to `OPEN` on the 5th failure; emitted `circuit_opened` with stats | **VERIFIED** |
| **3. Fast Fallback (<100ms)** | Target: <100ms | Fallback returned in **0–1ms**; **0** database queries dispatched while `OPEN` | **VERIFIED** |
| **4. Backoff & Jitter in Logs** | Exponential base 50ms, jitter $\pm 20\text{ms}$ | Attempt 1: 52ms delay; Attempt 2: 91ms delay; non-deterministic intervals logged | **VERIFIED** |
| **5. Circuit Recovery & Close** | `resetTimeout`: 1500ms | Transitioned to `halfOpen` after reset timeout; 1 trial probe succeeded; closed circuit (`circuit_closed`) | **VERIFIED** |

---

## 2. Telemetry Event Frequencies (Drill Output)

```
┌───────────────────────┬────────┐
│ Event Name            │ Count  │
├───────────────────────┼────────┤
│ retry_attempt         │ 2      │
│ dependency_timeout    │ 1      │
│ circuit_opened        │ 1      │
│ circuit_open_fallback │ 10     │
│ circuit_half_open     │ 1      │
│ circuit_closed        │ 1      │
└───────────────────────┴────────┘
```

---

## 3. Conceptual & Architectural Analysis

### Question 1: Product Behavior in Degraded Mode
- **Per-Dependency Failure Postures:**
  - **Redis Cache Outage:** Fails open gracefully by bypassing cache and retrieving canonical mappings directly from PostgreSQL.
  - **PostgreSQL Outage:** Serves existing active redirects from the in-memory/Redis L1 cache. If an uncached link lookup is requested during an open breaker, returns HTTP 503 (`TEMPORARY_UNAVAILABLE`) with a clear retry advisory. Never returns fabricated links or reports unpersisted mutations as successful.
  - **Analytics Queue Outage (BullMQ):** Fails open on the critical redirect path; redirects proceed immediately without blocking on click event processing.
  - **Authentication Outage:** Strictly fails closed; protected administrative endpoints reject unverified credentials.
- **Business Alignment:** Maximizes end-user availability for revenue-critical redirect traffic while fiercely preserving data integrity and security boundaries.

### Question 2: Resource Footprint — 5-Second Timeout vs. 500ms Timeout
- **Mathematical Modeling via Little's Law:**
  $$L = \lambda \times W$$
  Where:
  - $\lambda = 100\,\text{requests/sec}$ (arrival rate)
  - $W_1 = 5.0\,\text{sec}$ (conservative timeout) $\implies L_1 = 100 \times 5.0 = \mathbf{500\,\text{concurrent held connections}}$
  - $W_2 = 0.5\,\text{sec}$ (aggressive timeout) $\implies L_2 = 100 \times 0.5 = \mathbf{50\,\text{concurrent held connections}}$
- **Operational Impact:**
  - A 5-second timeout demands $10\times$ the concurrency footprint. With a standard database connection pool of 20–50 connections, all slots are instantly saturated within 200–500ms, queueing hundreds of requests in Node.js event-loop memory and causing socket exhaustion (`ECONNRESET`) across completely healthy endpoints.
  - A 500ms timeout bounds concurrency, drains the queue $10\times$ faster, and frees TCP descriptors and worker memory so the service remains responsive under degradation.
  - **Cancellation Propagation:** True resilience pairs client-side timeouts with `AbortController` cancellation so server resources are actively reclaimed rather than orphaned.
