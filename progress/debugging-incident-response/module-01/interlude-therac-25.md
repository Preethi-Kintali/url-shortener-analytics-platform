# Interlude: Therac-25 — When Software Kills
**Skill Track**: Debugging & Incident Response  
**Delivered Between**: Module 01 (Hypothesis-First Debugging) and Module 02 (Reading Logs Like a Story)

---

## The Historical Tragedy & The Debugging Lens
Between 1985 and 1987, the Therac-25 medical linear accelerator administered massive overdoses (15,000–25,000 rads in fractions of a second, compared to a standard 200 rad therapeutic dose) to at least six patients, killing three and permanently maiming others. 

The physical disaster stemmed from AECL's decision to remove the independent electromechanical hardware interlocks that had protected patients in the Therac-6 and Therac-20 models. The engineering disaster, however, was epistemic: AECL possessed an unwavering conviction that their software was defect-free because it had run for years without an accident. When patients reported burning pain and electric shocks, engineers looked at error-free logs and diagnostic tests that passed, dismissed the human reports as hysteria or equipment misunderstanding, and proclaimed the machine "virtually impossible" to overdose.

It was only when hospital physicist Fritz Hager at the East Texas Cancer Center methodically tested the premise that **the machine could fail**, spending weeks at the console varying typing speeds and parameter sequences until he reproduced the ~8-second keystroke race condition, that the fatal bug was unmasked.

---

## Question 1: Testable Hypotheses vs. Unfalsifiable Beliefs

> *The AECL engineers had a hypothesis — "the software works correctly" — but they never designed a test that could disprove it. They ran diagnostics that could only confirm their belief. A hypothesis you cannot disprove is not a hypothesis. It is a belief. When you are debugging, how do you make sure your hypotheses are genuinely testable? What does a good disconfirming test look like?*

### The Scientific Boundary: Karl Popper in the Terminal
A statement is only a scientific hypothesis if it is falsifiable—meaning there exists a conceivable observation or experiment that, if obtained, definitively proves the hypothesis false. AECL's assertion ("the software works correctly") is unfalsifiable because no single test can prove the absence of bugs across an infinite state space.

When debugging in complex software systems, we ensure hypotheses are genuinely testable by following three rules:
1. **Symmetric Falsifiability**: A valid hypothesis must predict both what *will* happen under condition $X$ and what *cannot* happen if the hypothesis is true. If any observation can be rationalized after the fact ("the diagnostic passed, so the patient must be wrong"), it is a dogma, not a hypothesis.
2. **Explicit Disconfirming Tests**: A good disconfirming test actively attempts to break the assumption. It deliberately probes edge cases, race conditions, unexpected typing speeds, and boundary inputs rather than happy-path sanity checks.
   - *Example from LinkOps*: For Bug #1, our hypothesis was "Postgres container is down." The disconfirming test was `docker ps` and `pg_isready`. In 5 seconds, a successful port ping disproved container failure, instantly killing that line of investigation.
   - *Example from Therac-25*: A disconfirming test would have been: "If we simulate rapid operator input (< 1 second between field edits) during turntable magnet positioning, will the software ever arm the high-energy beam while the target is unpositioned?"

---

## Question 2: The Mask of Safety Nets — Hidden Latent Defects

> *The race condition existed in the Therac-20 for years, but hardware interlocks masked it completely. The bug was real, present, and firing — and nobody knew, because another layer caught the failure. What "safety nets" exist in your own systems — caches, retries, fallback defaults, load balancers, circuit breakers — that might be silently catching bugs you have never seen? If you removed one of those safety nets tomorrow, what would break?*

### Modern Software's Invisible Crutches
Modern distributed architectures are filled with defensive buffers designed to preserve user-facing availability. While essential for resilience, these buffers frequently act as "silent suppressors," hiding critical defects until traffic patterns shift or a defense layer is removed.

1. **Redis Cache-Aside as a Query Crutch**:
   - *The Hidden Bug*: Unindexed, quadratic ($O(N^2)$) joins or missing composite indexes in the database layer.
   - *The Mask*: Redis caches 99.8% of requests. Response times are 4ms. The team believes their data layer is highly optimized.
   - *The Catastrophe*: A Redis cluster failover or cold-start cache purge occurs. Every incoming request hits Postgres simultaneously. Queries that normally take 2ms take 14 seconds; database connection pools saturate in 3 seconds; cascading 504 gateway timeouts take down the entire platform.
2. **Exponential Retries Masking Downstream Deadlocks**:
   - *The Hidden Bug*: Ephemeral socket timeouts and unhandled concurrency collisions.
   - *The Mask*: An HTTP client retry policy (3 attempts with exponential backoff) silently converts 15% failure rates into successful 200 responses with an extra 200ms of latency.
   - *The Catastrophe*: When traffic triples during a marketing event, the 15% failure rate triggers a retry storm, multiplying backend request volume by $3\times$, overwhelming the database connection pool, and causing a total system freeze.
3. **Graceful Fallbacks Masking Third-Party Contract Drift**:
   - *The Hidden Bug*: An external geolocation or fraud scoring API changes its JSON schema.
   - *The Mask*: A `try/catch` block defaults to `fallbackCountry: "US"` or `fraudScore: 0`. Everything returns HTTP 200.
   - *The Catastrophe*: Real fraud bypasses detection for six weeks because zero exceptions bubbled to monitoring alerts.

Removing any single safety net tomorrow would expose whether downstream components actually adhere to their contracts or whether they are merely being propped up by upstream tolerance.

---

## Question 3: Human Feedback vs. Green Telemetry

> *The patients told their doctors something was wrong. They described burning, shock, pain. The operators checked the machine's logs, saw green, and concluded the patients must be mistaken. When have you trusted a dashboard, a metric, or a log file over a human being who told you "something is wrong"? What would it take for you to trust the human over the telemetry?*

### The Seduction of the Green Dashboard
In software engineering, metrics and logs reflect only **what we had the foresight to instrument**. Telemetry is not objective reality; it is a selective, filtered projection of reality.

When a user complains: *"Your app charged my card twice,"* but Stripe logs show a single successful webhook and the DB shows one row, the junior instinct is to say: *"The user is confused or looking at a pending authorization hold."*

Yet, human perception is the ultimate canary. Humans feel the friction of the system directly:
- When a user says: *"I clicked submit and the screen froze,"* even if server response time P99 is 45ms, the client-side JavaScript main thread may be locked by an unprofiled $O(N^3)$ DOM manipulation loop.
- When an operator says: *"The system feels sluggish,"* an unmonitored queue lag or GC pause may be accumulating beneath the resolution of a 1-minute aggregation metric.

### The Rule of Human Anomaly Precedence
To prevent the Therac-25 failure mode in modern operations:
1. **Never use absence of error logs as proof of correctness**: Silence in telemetry means only that no assertion failed; it does not mean the system did what the user needed.
2. **Treat human anomaly reports as high-priority unexplained symptoms**: When human reports contradict telemetry, the immediate hypothesis must be: **"Our telemetry has a blind spot."**
3. **Actively search for the gap between the instrumented model and physical reality**: Investigate the exact client runtime, network path, timing sequence, and user behavior that telemetry smoothed over.
