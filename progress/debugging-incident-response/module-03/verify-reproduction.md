# Module 03 VERIFY: Reproduction Science & Concurrency Invariants

## Question 1: Isolating the Governing Variable (Data, Timing, Concurrency)

### The Governing Variable: Concurrency
The variable that governed this defect was **Concurrency**—specifically, the interleaving of asynchronous execution frames across competing database transactions within a shared timestamp bucket.

### How Data and Timing Were Eliminated
1. **Data Shape Elimination**:
   - Sequential requests using the exact same link ID (`linkId: 42`), short code (`test-link`), and bucket payload succeeded 100% of the time.
   - The failure did not depend on slug length, Unicode characters, or entity metadata.
2. **Timing Rollover Elimination**:
   - The bug was not confined to hourly boundary transitions or midnight rollovers.
   - When tested against an empty bucket at any arbitrary second (e.g. `14:23:18Z`), concurrent requests triggered the duplicate key constraint violation identically.
3. **Concurrency Confirmation**:
   - Sending requests sequentially: 0% failure rate.
   - Sending 10 concurrent requests via `Promise.all()`: 90% failure rate on the first batch, deterministically reproducing `analytics_link_id_bucket_unique` violation.

---

## Question 2: Single-Threaded Testing vs. Production Reality

### Could a Single `curl` Command Ever Find This?
**No, never.** A single `curl` command executes in complete isolation. The execution takes approximately 10–15 milliseconds:
- `SELECT` executes at $t=2\text{ms}$.
- Evaluates `!existing` at $t=4\text{ms}$.
- `INSERT` executes at $t=6\text{ms}$.
- Response returns at $t=10\text{ms}$.

Because there is no second thread or competing request active in the 4-millisecond window between $t=2\text{ms}$ and $t=6\text{ms}$, the check-then-act logic appears completely flawless.

### The Gap Between "I Tested It" and "I Tested It Thoroughly"
- **"I tested it" (Junior Testing)**: Proves that the code works under idealized single-user serial conditions when the system is quiet.
- **"I tested it thoroughly" (Senior Engineering)**: Proves that the code maintains its state invariants under the physical realities of production: high concurrency, network latency jitter, competing database locks, and interleaved event-loop ticks.

---

## Question 3: The Check-Then-Act Signature Across the Codebase

The pattern:
```typescript
// ANTI-PATTERN: Check-Then-Act Race
const existing = await db.findFirst({ where: { key } });
if (!existing) {
  await db.create({ data: { key, ... } });
}
```
This signature represents an architectural vulnerability wherever concurrent writes occur:

1. **Custom Short-Code Creation (`POST /links`)**:
   - If two users simultaneously attempt to claim custom alias `promo2026`:
     - Both query `SELECT * FROM links WHERE code = 'promo2026'`. Both see zero rows.
     - Both attempt `INSERT INTO links (code) VALUES ('promo2026')`.
     - One succeeds; the second crashes with a 500 error instead of a clean 409 Conflict.
2. **User Onboarding / Team Member Invitation (`POST /teams/members`)**:
   - Simultaneously adding the same user email to a team:
     - Check: `SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2`.
     - Action: `INSERT INTO team_members ...`.
     - Collides on the composite unique index `(team_id, user_id)`.
3. **Sliding-Window Rate Limiting Counters**:
   - Checking an API token's request count before incrementing. Concurrent bursts read the stale counter and bypass the rate limit threshold.

---

## Question 4: Concurrency Scaling Dynamics ($N=2$, $N=10$, $N=1000$)

### Why $N=10$?
$N=10$ provides an optimal overlap density. In a 5ms database query window, 10 concurrent Node.js HTTP requests ensure that between 4 and 8 requests are active inside the race window simultaneously, yielding a **$\approx 100\%$ reproduction probability** on the first run without stressing local system resources.

### What if $N=2$?
- The theoretical minimum concurrency required to trigger the bug is $N=2$.
- However, with only 2 requests, slight differences in local DNS lookup, TCP socket allocation, or Node.js microtask scheduling can space the two requests by 6ms, causing Request 2 to arrive *after* Request 1 has already committed its `INSERT`.
- Result: The bug triggers intermittently (e.g., 3 out of 10 runs), misleading junior developers into labeling the test "flaky."

### What if $N=1000$?
- At $N=1000$, secondary infrastructure failure modes emerge:
  - OS ephemeral socket exhaustion (`EADDRNOTAVAIL`).
  - Database connection pool exhaustion (`timeout waiting for connection from pool`).
  - HTTP server backpressure and dropped TCP handshakes (`ECONNRESET`).
- These secondary failures mask the race condition under a flood of connection timeout errors.

### Production Probability Insight
The minimum threshold to trigger the race condition is just **2 overlapping requests within a 5ms window**. On a popular short link handling 600 redirects per minute ($\approx 10\text{ req/sec}$), the arrival interval between requests is $\approx 100\text{ms}$. Under Poisson arrival distributions, two requests arriving within 5ms occurs dozens of times every hour. On popular links, this bug is not an anomaly—it is a statistical certainty.
