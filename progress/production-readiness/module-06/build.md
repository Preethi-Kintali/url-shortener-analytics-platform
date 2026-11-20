# Module 06: Graceful Degradation & Circuit Breaking - Build Report

## 1. Chunk 1: Explicit Timeouts on External Calls
- **Implementation:** Added `executeWithTimeout` in `src/common/resilience/circuit-breaker.service.ts` using `AbortController` and `AbortSignal`.
- **Enforced Timeouts:**
  - Standard database operations: 1,000ms.
  - Redis cache operations: 500ms (`commandTimeout`).
- **Telemetry Event:** Emits structured `dependency_timeout` event on threshold exceedance:
  ```json
  {
    "level": "WARN",
    "event": "dependency_timeout",
    "dependency": "database",
    "operation": "findUniqueLink",
    "timeout_ms": 300,
    "request_id": "req-uuid"
  }
  ```

---

## 2. Chunk 2: Circuit Breaker Implementation (`opossum`)
- **Package Installed:** `opossum` v10.0.0 and `@types/opossum`.
- **Configuration Defaults:**
  - `timeout`: 1,000ms (calls exceeding 1s count as failure).
  - `errorThresholdPercentage`: 50% (trips when half of evaluated volume fails).
  - `volumeThreshold`: 5 (minimum requests required before percentage evaluation).
  - `resetTimeout`: 30,000ms (configurable via `CIRCUIT_RESET_TIMEOUT_MS`).
- **State Transition Telemetry & Event Hooks:**
  - `open`: Emits `event: "circuit_opened"` (level `ERROR`) with breaker statistics.
  - `halfOpen`: Emits `event: "circuit_half_open"` (level `INFO`).
  - `close`: Emits `event: "circuit_closed"` (level `INFO`).
  - `fallback`: Emits `event: "circuit_open_fallback"` (level `WARN`) returning cached or degraded response in <1ms without contacting the failed dependency.

---

## 3. Chunk 3: Retries with Exponential Backoff and Jitter
- **Utility:** `src/common/resilience/retry-backoff.util.ts` (`retryWithBackoff`).
- **Algorithm:**
  $$T_{\text{delay}} = \min(T_{\text{base}} \times 2^{\text{attempt}}, T_{\text{max}}) \pm \text{Jitter}$$
  - `maxRetries`: 3.
  - `baseDelay`: 100ms.
  - `maxDelay`: 2,000ms.
  - `jitter`: $\pm 50\text{ms}$ randomness (decorrelates retry waves, preventing thundering herds).
- **Fail-Fast Boundary:** Only retries transient network errors (`ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `EAI_AGAIN`, `P1001`, `P1002`). Rejects permanent errors (400, 401, 404) immediately without retrying.

---

## 4. Failure-First Drill Execution Proof
- Drill executed via `drill-circuit-breaker.js`:
  1. **Phase 1 (DB Down):** 5 consecutive requests failed/timed out $\to$ Breaker tripped to `OPEN` (`circuit_opened` emitted).
  2. **Phase 2 (Circuit OPEN):** Requests 6–10 returned immediate fallback in 0–1ms $\to$ Zero database queries dispatched (`dbCallsDuringOpen = 0`).
  3. **Phase 3 (DB Restored & Recovery Timeout):** After reset timeout, transitioned to `HALF-OPEN` (`circuit_half_open` emitted).
  4. **Phase 4 (Probe Trial):** 1 probe request routed to recovered dependency $\to$ Succeeded $\to$ Circuit closed (`circuit_closed` emitted).
