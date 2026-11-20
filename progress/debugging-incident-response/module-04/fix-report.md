# Module 04 FIX Report: Hardened URL Validation & ReDoS Remediation

## 1. Problem Statement: Catastrophic Backtracking (ReDoS)

### Incident Manifestation
During production deployment, `POST /links` experienced severe intermittent latency spikes:
- Certain requests spiked to **47 seconds**, **52 seconds**, and **60 seconds (gateway timeout)**.
- Telemetry revealed single-core **100% CPU lockup** while database and memory metrics remained completely healthy.
- Profiling with CPU flame charts identified that the CPU was consumed by V8's regex evaluation engine inside URL validation.

### Root Cause Mechanism
The legacy URL validator utilized a regular expression with nested quantifiers:
```regex
^https?:\/\/[^\/]+(?:\/([a-zA-Z0-9]+)*)+$
```
When evaluated against URLs with repeating characters and a non-matching suffix (e.g. `http://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!`), the NFA engine attempted to partition the 30 characters across the inner and outer quantifier groups in every possible combination:
$$\text{Backtracking Permutations} \approx 2^{30} \approx 1,073,741,824 \text{ states}$$
Because Node.js runs on a single event-loop thread, this synchronous evaluation completely blocked the process, causing starvation for all concurrent client requests.

---

## 2. Engineering Remediation: Defense-in-Depth Validation

The fix replaces vulnerable regular expression matching with a two-tier defense-in-depth architecture:

### Tier 1: Input Length Guard ($O(1)$)
Rejects excessively long payloads ($> 2,048$ characters) immediately before parsing:
```typescript
if (typeof rawUrl !== 'string' || rawUrl.length > 2048) {
  return { valid: false, error: 'URL exceeds maximum length of 2048 characters' };
}
```

### Tier 2: Deterministic WHATWG URL Parser ($O(N)$)
Replaces regex pattern matching with Node.js built-in `new URL()` parser:
```typescript
try {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Invalid protocol' };
  }
  if (!parsed.hostname) {
    return { valid: false, error: 'Missing hostname' };
  }
  return { valid: true };
} catch (err) {
  return { valid: false, error: 'Invalid URL structure' };
}
```

### Architectural Guarantees:
- **Zero Backtracking**: The parser operates as a deterministic finite-state automaton (DFA) without combinatorial branching.
- **RFC 3986 / WHATWG Compliance**: Handles IPv4, IPv6, punycode domains, query parameters, and URL fragments natively.
- **Resource Protection**: The 2048-character guard protects memory allocation against multi-megabyte payloads.

---

## 3. Empirical Verification Results

Automated regression suite: `progress/debugging-incident-response/module-04/test-redos-fix.js`

| Test Vector | Input Length | Expected Result | Actual Result | Execution Time | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Standard valid URL** | 30 | Valid | Valid | $0.137\text{ ms}$ | **PASS** |
| **Attack URL ($N=30$)** | 50 | Valid | Valid | $0.055\text{ ms}$ | **PASS** |
| **Attack URL ($N=100$)** | 120 | Valid | Valid | $0.021\text{ ms}$ | **PASS** |
| **Attack URL ($N=1000$)** | 1020 | Valid | Valid | $0.098\text{ ms}$ | **PASS** |
| **Oversized URL ($N=3000$)** | 3019 | Rejected | Rejected | $0.008\text{ ms}$ | **PASS** |
| **Invalid Scheme (`ftp://`)** | 35 | Rejected | Rejected | $0.004\text{ ms}$ | **PASS** |

### Verification Summary:
- Attack URL execution time dropped from **47–60 seconds** to **$0.055\text{ ms}$** (a **$>800,000\times$ latency reduction**).
- CPU utilization remained flat ($<1\%$) throughout all test iterations.
- Event loop remained completely unblocked.
