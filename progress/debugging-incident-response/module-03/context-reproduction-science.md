# Module 03 CONTEXT: Reproduction Science — Turning Flaky into Deterministic

## 1. The Core Engineering Challenge: "It Only Happens in Production"
The phrase "it only happens in production" is never an acceptable engineering conclusion. Software executing on deterministic CPU state machines does not behave randomly; what engineers label "flaky," "heisenbugs," or "intermittent" are simply deterministic defects governed by variables the engineer has not yet identified or controlled.

The objective of **Reproduction Science** is to replace intuition and wishful thinking with controlled experiments, turning *"it happens sometimes"* into *"it happens 100% of the time when running this reproduction script."*

---

## 2. Core Concepts: Concurrency & Flakiness

### Race Condition: The Empty Chair Analogy
Imagine two people in a waiting room seeing a single open chair. Both observe that the chair is empty at time $t_0$. Both walk toward it and sit down at $t_1$. One person ends up on the floor.

In software, a **race condition** occurs when two concurrent operations read state, evaluate a predicate ("no existing record with short_code = x"), and execute a state-mutating action ("INSERT INTO links"), unaware that another worker executed the same check concurrently.
- Run sequentially: 100% green.
- Run simultaneously: Unhandled collision, double-charge, unique constraint violation, or data corruption.
- The defect is timing-dependent: both execution paths are individually valid, but their interleaved execution violates system invariants.

### Flaky vs. Deterministic
- **Deterministic Failure**: 100% repeatable. Condition $A \to$ Failure $B$ on every execution.
- **Flaky Failure**: Appears probabilistic (e.g., 9 passes out of 10 runs).
- **The Core Insight**: Almost every flaky bug is strictly deterministic once the hidden variable (concurrency window, network packet delay, memory pressure, cache eviction, or clock skew) is isolated and controlled.

---

## 3. Micro-Exercise: Analysis & Answers

### Question 1: A user reports "the app is slow sometimes." What three questions do you ask to narrow this down?
To convert the vague symptom "sometimes" into a deterministic trigger, we isolate three distinct dimensions of variance:

1. **Temporal & Contention Dimension**:
   - *"When specifically does this slowness occur, and what scheduled jobs or traffic spikes coincide with that window?"*
   - *Underlying Variable*: Isolates background cron jobs, database backups, cache TTL expirations, or peak concurrent user traffic saturating the connection pool.
2. **Data & Payload Boundary Dimension**:
   - *"Which exact user account, project, or query parameters experience this, and how large is the underlying dataset?"*
   - *Underlying Variable*: Isolates volume-dependent complexity, such as an unindexed query scanning 500,000 rows ($O(N)$ table scans), N+1 queries multiplying with result set size, or memory exhaustion on large JSON serializations.
3. **Route, Operation & Topology Dimension**:
   - *"What specific action or endpoint was invoked, and does it happen across all clients or only specific geographical/network routes?"*
   - *Underlying Variable*: Differentiates a slow write path (`POST /links` hitting database write locks) from a slow read path (`GET /r/:code`), isolating CDN edge cache misses, TLS handshake latency, and database lock contention.

---

### Question 2: What is the difference between "I cannot reproduce it" and "it is not reproducible"? Which one should you say out loud in a standup?

- **"I cannot reproduce it"**:
  - *Epistemic reality*: An honest, humble, and accurate statement about the engineer's current investigative state. It states: *"Given the test parameters, local single-threaded environment, and seed data I have tested so far, the failure mode has not triggered. The governing variable remains unidentified."*
- **"It is not reproducible"**:
  - *Epistemic fallacy*: An arrogant, ungrounded metaphysical claim about the universe. It asserts that the software failure cannot be caused by any set of inputs, timing, or states—which directly contradicts the fact that the user experienced it in production.
- **What to say in a standup**:
  - **Always say "I have not yet reproduced it."**
  - Pair it immediately with the variables you have eliminated and the next boundary you are testing:  
    *"I have not yet reproduced the checkout failure under single-user sequential tests. Since unit tests pass, my next step is testing under high-concurrency burst conditions using a 20-thread reproduction script."*
