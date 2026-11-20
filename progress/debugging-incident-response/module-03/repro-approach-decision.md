# Module 03 DECIDE: Reproduction Approach (Production Replay vs. Synthetic Reproduction)

## Context & The Dilemma
In Step 2 of Module 03, we face an intermittent HTTP 500 error appearing unpredictably a few times per hour on popular short links in `linkops`. To fix it, we must first reproduce it deterministically.
- **Option A: Production Replay (`production_replay`)** — Capture and replay live production traffic (headers, payloads, timing) against local environments.
- **Option B: Synthetic Reproduction (`synthetic_repro`)** — Write an isolated, minimal script that simulates the specific suspected trigger (concurrency, race conditions, edge-case data) from scratch.

---

## Probing Questions Analysis

### 1. Privacy & Compliance Boundary
*What are the privacy implications of replaying real user requests on your development machine?*
- Capturing raw production traffic captures real user sessions: auth tokens, cookies, PII, email addresses, and private URLs landing unencrypted on developer laptops.
- This creates severe compliance violations (GDPR, SOC2, HIPAA) and data leakage risks.
- Synthetic reproduction generates zero PII, uses deterministic synthetic test fixtures, and requires no regulatory clearance or sanitization pipeline.

### 2. Iteration Speed & The Flakiness Trap
*Which approach lets you iterate faster when your first theory is wrong?*
- Production replay is sluggish: recording, transferring, and replaying a 2-hour traffic capture takes hours per attempt, and if the bug requires a rare 1-millisecond concurrency window, replaying at 1x speed may still fail to trigger it.
- Synthetic reproduction allows instant parameter adjustments: scaling from 5 concurrent requests to 50 concurrent requests takes 5 seconds, tightening the execution loop from hours to seconds.

### 3. Shareability & Regression Defense
*Which approach produces a more shareable artifact?*
- Replay bundles are multi-gigabyte PCAP/binary dumps that cannot be checked into git, cannot run hermetically in CI, and cannot be shared across team environments without infrastructure dependencies.
- A synthetic script is a 20-line self-contained script (`test-concurrency-repro.js`) that runs in under 2 seconds, can be checked into version control, and serves as an automated regression test in CI pipelines forever.

---

## Decision Record
We choose **Option B: Synthetic Reproduction (`synthetic_repro`)**.

### Selected Rationale
For intermittent errors on popular routes, concurrency collisions are the primary suspect. Option B (Synthetic Reproduction) allows us to test this hypothesis directly using controlled concurrent bursts (`Promise.all`) without the severe compliance hazards of dumping production PII to local machines. Synthetic scripts provide rapid sub-second iteration, isolate the exact governing variable, and produce an enduring, lightweight regression harness that runs in CI to verify the fix permanently.
