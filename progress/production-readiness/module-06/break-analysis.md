# Module 06: Graceful Degradation & Circuit Breaking - Break Analysis

## 1. Investigated Failure Modes & Diagnostic Findings

### Failure A: The Runaway Retry
- **Observed Symptom:** Extreme CPU spike, Node.js event-loop timer exhaustion, memory growth, hundreds of retry attempts logged for a single slow request.
- **Root Cause:**
  - Removal of the `maxRetries` boundary (`maxRetries = Infinity` or uncontrolled while-loop).
  - Failure to discriminate between transient errors (`ECONNRESET`, `ETIMEDOUT`) and permanent errors (400 Bad Request, 404 Not Found, 401 Unauthorized), causing the application to loop indefinitely on deterministic client failures.
- **Remediation:** Enforce a hard ceiling (`maxRetries = 3`), cap maximum delay (`maxDelay = 2000ms`), and strictly evaluate error codes against an explicit transient whitelist.

---

### Failure B: The Circuit That Never Heals
- **Observed Symptom:** Following a brief database outage and subsequent database recovery, the API continues to return fallback responses indefinitely; the circuit breaker remains locked in the `OPEN` state.
- **Root Cause:**
  - `resetTimeout` configured to an unreachable value (e.g., 999,999,999ms) or broken half-open transition handler where probe errors unconditionally reopen the circuit without recording successful responses.
- **Remediation:** Configure production-grade recovery windows (30,000ms in production, overridable via `CIRCUIT_RESET_TIMEOUT_MS` for hermetic testing), and guarantee atomic state transitions from `halfOpen` to `closed` on single probe success.

---

### Failure C: The Synchronized Stampede (Thundering Herd)
- **Observed Symptom:** A recovering database is immediately knocked back offline upon restarting; logs show retry attempts from dozens of clients occurring at identical millisecond timestamps.
- **Root Cause:**
  - Omission of randomized **jitter** from the exponential backoff calculation:
    $$T_{\text{delay}} = T_{\text{base}} \times 2^{\text{attempt}}$$
  - When 20–100 concurrent clients fail simultaneously at $T=0$, all clients retry synchronously at $T+100\text{ms}$, $T+200\text{ms}$, $T+400\text{ms}$. The resulting shockwave overwhelms the recovering database, causing cyclic collapse.
- **Remediation:** Add full decorrelated jitter ($\pm 50\text{ms}$ or uniform random offset), spreading retry arrivals across a smooth Gaussian/uniform distribution.
