# Module 06: Graceful Degradation & Circuit Breaking - Context

## 1. Core Resilience Patterns

### A. The Circuit Breaker Pattern
A circuit breaker protects an application from cascading failure when a downstream dependency (database, cache, external API) fails or slows down.

```
       ┌───────────────────────────────┐
       │            CLOSED             │◄────────────────┐
       │   (Normal: traffic allowed)   │                 │
       └──────────────┬────────────────┘                 │
                      │ Failures > Threshold             │ Success
                      ▼                                  │
       ┌───────────────────────────────┐                 │
       │             OPEN              │                 │
       │ (Tripped: fast-fail fallback) │                 │
       └──────────────┬────────────────┘                 │
                      │ Sleep timeout expires            │
                      ▼                                  │
       ┌───────────────────────────────┐                 │
       │           HALF-OPEN           │─────────────────┘
       │     (Trial probe request)     │
       └──────────────┬────────────────┘
                      │ Failure
                      ▼
               (Back to OPEN)
```

- **Closed (Normal):** All requests pass through to the dependency. Metrics track latency and failure rate.
- **Open (Tripped):** Upstream failures exceed threshold (e.g. 5 failures in 30s). All requests are immediately rejected or routed to a fallback in <5ms without calling the dependency.
- **Half-Open (Testing):** After a cooldown period (e.g. 30s), a single probe request is allowed through. If it succeeds, the breaker resets to Closed; if it fails, it returns to Open.

---

## 2. Retries, Exponential Backoff, and Jitter

- **Uncontrolled Retries:** Mashing redial amplifies load on an already struggling downstream dependency.
- **Exponential Backoff:** Progressively lengthens sleep intervals between retry attempts:
  $$T_{\text{wait}} = \text{base} \times 2^{\text{attempt}}$$
- **Jitter (Decorrelation):** Adds randomness (e.g., $\text{wait} \pm \text{random}$) to break synchronization among concurrent clients, preventing the **thundering herd** phenomenon where hundreds of clients hammer the recovering dependency in synchronized waves.

---

## 3. Micro-Exercise Analysis: The Math of Cascading Retries

1. **User-Perceived Latency under Slow Downstream:**
   - Database latency: 5,000ms (normal 50ms).
   - Retry policy: 3 retries (4 total attempts).
   - User response time: $4 \times 5\,\text{s} = 20\,\text{seconds}$.
2. **Amplified Downstream Load:**
   - 100 concurrent incoming requests $\times 4$ attempts $= 400$ requests sent to the already degraded database. The load is multiplied by $4\times$, virtually guaranteeing total database collapse.
3. **Failing Fast vs. Slow Success:**
   - **Why a 200ms Error Beats a 20s Success:**
     - **Client UX:** In 20 seconds, the user will have refreshed the page multiple times (spawning even more requests) or abandoned the transaction entirely. A 200ms error or graceful fallback allows the UI to render cached content or give actionable feedback immediately.
     - **Server Resource Preservation:** Holding a connection open for 20 seconds occupies a TCP socket, holds HTTP request buffers, locks a worker thread or event loop state, and exhausts the connection pool. Failing fast releases resources in 200ms so healthy endpoints continue serving traffic without degradation.
