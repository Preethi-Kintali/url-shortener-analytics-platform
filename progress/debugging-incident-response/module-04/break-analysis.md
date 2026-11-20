# Module 04 BREAK Analysis: ReDoS & Catastrophic Backtracking Profiling

## 1. Incident Overview & Telemetry Symptoms
Following the remediation of connection pool leaks and N+1 queries, production monitoring triggered a critical latency incident on `POST /links`:
- **Alert**: Latency spikes on `POST /links` registering 47s, 52s, and timeouts at 60s.
- **Resource Profiling**:
  - **Memory**: Completely stable; zero heap spikes or connection pool growth.
  - **Database**: Zero slow queries; PostgreSQL execution times $<5\text{ms}$.
  - **CPU**: A single CPU core spiked to **100% utilization** exclusively during the affected requests.
- **Payload Pattern**: The requests carried long URLs containing repeating alphanumeric sequences ending with an unexpected character:
  `http://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!`

---

## 2. Tool-Led Profiling: CPU Hotspot Isolation

Attaching a CPU profiler (via Node.js `--cpu-prof` and Chrome DevTools performance sampling) revealed the exact execution bottleneck:
- **Hot Function**: The execution time was concentrated inside the V8 regular expression engine:
  `v8::internal::RegExpExec` / `RegExp.prototype.test()`.
- **Call Stack**:
  ```text
  LinksController.create()
    -> CreateLinkDto validation
      -> IsValidDestinationUrlConstraint.validate()
        -> RegExp.prototype.test()  [100% of CPU time for 47-52 seconds]
  ```
- **Vulnerable Pattern**:
  ```regex
  ^https?:\/\/[^\/]+(?:\/([a-zA-Z0-9]+)*)+$
  ```

---

## 3. Root Cause: Catastrophic Backtracking ($O(2^N)$)

### The Mechanics of Nondeterministic Finite Automata (NFA)
Most programming language regex engines (including JavaScript V8 and Python `re`) use NFA engines with backtracking:
1. The regex contains nested quantifiers: an outer `(...)+` containing an inner `(...)*` over overlapping character sets (`[a-zA-Z0-9]+`).
2. When presented with 30 repeating `a`'s followed by `!` (which fails the anchor `$`):
   - The engine matches all 30 `a`'s in the first group.
   - The engine encounters `!`, which does not match `[a-zA-Z0-9]`.
   - The engine backtracks: it shrinks the first group to 29 `a`'s and attempts to match the remaining `a` with a second iteration of the outer group.
   - It recursively tries every binary partition of dividing 30 characters among nested quantifier groups:
     $$\text{Search Space} = \sum_{k=1}^N \binom{N-1}{k-1} = 2^{N-1}$$
3. For $N=30$, this generates over **$536,870,912$ backtracking states**.
4. In single-threaded Node.js, this synchronous computation blocks the entire event loop, freezing all other concurrent HTTP traffic.

### Empirical Profiling Data:
| Repeats ($N$) | Evaluation Time (ms) | Complexity Factor |
| :---: | :---: | :---: |
| **10** | $0.11\text{ ms}$ | Baseline |
| **14** | $0.26\text{ ms}$ | $2.3\times$ |
| **18** | $4.01\text{ ms}$ | $15.7\times$ |
| **20** | $16.43\text{ ms}$ | $4.1\times$ |
| **22** | $65.99\text{ ms}$ | $4.0\times$ |
| **24** | $260.39\text{ ms}$ | $3.9\times$ |
| **30 (extrapolated)** | **$\approx 16,665\text{ ms}$** | Continuous $4\times$ per 2 characters |
| **32 (extrapolated)** | **$\approx 66,660\text{ ms}$** | Exceeds 60s gateway timeout |

---

## 4. Engineering Remediation: Linear-Time URL Parsing

Regexes should not be used to parse or validate complex URI grammars. The remediation replaces the regular expression with standard **WHATWG URL parser (`new URL()`)**:
- Implements RFC 3986 / WHATWG specification in deterministic $O(N)$ linear time.
- Completes in $<0.03\text{ms}$ regardless of input length or character repetition.
- Eliminates ReDoS vulnerabilities permanently at the architectural boundary.
