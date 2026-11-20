# Module 05: Iteration Patterns — STEP 5: BREAK
## Adversarial Investigation: The Iteration Spiral & Context Pollution Regressions

**Course**: Upsk AI-Augmented Engineering (Practitioner Pack)  
**Module**: Module 05 — Iteration Patterns  
**Step**: STEP 5: BREAK — The Spiral  
**Target Component**: `ActivityFeedGateway` & `ActivityFeedService`  
**Investigation Focus**: Identifying and empirically reproducing regressions introduced by repeated refinements in multi-turn AI workflows.

---

## 1. Executive Summary & The Iteration Spiral Scenario

In Step 5, we investigate the fundamental failure mode of iterative AI code generation: **The Iteration Spiral (Context Pollution Regression)**.

### The Scenario
Across Rounds 1 and 2, connection handling was stable:
- Round 1 established basic socket lifecycle.
- Round 2 cleanly refactored the gateway, introducing handshake authentication and room-based tenant isolation. Connections remained open and reliable.
- In Round 3, a follow-up refinement prompt instructed the AI agent to implement two production features:
  1. Connection resilience (a 30-second heartbeat ping/pong with zombie socket cleanup).
  2. Reconnection resilience (event replay buffer for reconnecting clients).

The AI agent successfully wrote the methods for both features. However, the Round 3 output introduced a **severe hidden regression**:
> **Surface Symptom**: The WebSocket connection establishes normally. The first event is delivered. Shortly thereafter, the connection silently drops with close code `4008`. No application error is logged; live event streaming simply ceases.

---

## 2. Empirical Defect Reproductions

Test Harness: `progress/evidence/module-05/repro-spiral.js`  
Execution Log: `progress/evidence/module-05/spiral-repro-log.txt`  
Command: `node progress/evidence/module-05/repro-spiral.js`

### Defect 1: The Silent Disconnection Regression (Heartbeat vs. Passive Listener Collision)

#### Failing Code Location
File: `progress/evidence/module-05/activity-feed.gateway.ts` (Lines 158–172)
```typescript
  // Round 3 Heartbeat Sweep Implementation
  sweepInactiveClients(maxIdleMs = 30000): number {
    const now = Date.now();
    let disconnectedCount = 0;

    for (const [clientId, client] of this.activeClients.entries()) {
      // DEFECT: Checks !client.isAlive regardless of actual elapsed idle time!
      if (now - client.lastActiveAt > maxIdleMs || !client.isAlive) {
        this.handleDisconnect(clientId, 4008);
        disconnectedCount++;
      } else {
        client.isAlive = false; // Toggles false; expects client ping to flip true
      }
    }
    return disconnectedCount;
  }
```

#### Mechanical Root Cause
1. **Asymmetric State Management**: In WebSocket architectures, an activity feed is predominantly a *downlink stream* (server-to-client). A user on a team dashboard is an active listener reading updates.
2. **Missing Touch in Event Dispatch**: When `ActivityFeedService` dispatches events via `subscriberAdapter.send(event)`, the gateway merely executes `client.emit('activity_event', event)`. It does **not** update `client.lastActiveAt` or set `client.isAlive = true`.
3. **The Sweep Trap**:
   - On connection, `client.isAlive` is `true`.
   - Event 1 is successfully delivered.
   - Sweep Cycle 1 runs: `now - client.lastActiveAt` is only 15 seconds (< 30s max idle), and `isAlive` is `true`. The sweep falls into the `else` branch and sets `client.isAlive = false`.
   - The user continues reading events. Because the user is passive, the client socket does not transmit an explicit upstream frame.
   - Sweep Cycle 2 runs: The condition `!client.isAlive` evaluates to `true`!
   - The gateway forcibly terminates the socket via `this.handleDisconnect(clientId, 4008)`.
   - The user is disconnected after receiving the first event, despite having an active, healthy TCP connection.

#### Execution Output from Reproduction Harness
```text
--- TEST 1: Reproducing Silent WebSocket Disconnection After First Event ---
[STATE] Client 'client_desktop_user' connected: connected=true, isAlive=true
[EVENT_DELIVERY] First event delivered: count=1, seq=1

[HEARTBEAT_CYCLE_1] Server executes first sweep...
[SWEEP_MARK] Client 'client_desktop_user' marked isAlive=false for next cycle
[STATE] After Cycle 1: client.connected=true, client.isAlive=false

[HEARTBEAT_CYCLE_2] Server executes second sweep...
[SWEEP_EVICT] Client 'client_desktop_user' evicted: isAlive=false, idleMs=6

[REPRODUCTION_EVIDENCE]:
- Client connected state: false
- Disconnect close code: 4008
- Total evicted clients: 1
[CONFIRMED_DEFECT_1] SILENT DISCONNECT REPRODUCED: Active listener was terminated by heartbeat sweep despite active event flow!
```

---

### Defect 2: Reconnection Replay Out-of-Order Race Condition & Duplicate Dispatch

#### Failing Code Location
File: `progress/evidence/module-05/activity-feed.gateway.ts` (Lines 116–134)
```typescript
  // Round 3 Reconnection Replay Implementation
  handleReconnect(clientId: string, teamId: string, lastSequenceNumber: number) {
    // FLAW 1: Joins live channel BEFORE replaying missed events!
    const joinResult = this.handleJoinTeam(clientId, teamId);
    if (!joinResult.success) return { success: false };

    const client = this.activeClients.get(clientId)!;
    const missedEvents = this.activityFeedService.getEventsSince(teamId, lastSequenceNumber);

    // FLAW 2: Live events published concurrently arrive during this loop!
    for (const evt of missedEvents) {
      client.emit('activity_event', evt);
    }
  }
```

#### Mechanical Root Cause
1. **Premature Subscription Registration**: `handleReconnect` immediately calls `handleJoinTeam(clientId, teamId)`. This registers the socket adapter in `teamSubscribers` right away.
2. **Concurrent Inversion**: If another team member publishes an event (e.g., Sequence 4) while the server is iterating through missed events (Sequences 2 and 3), the real-time subscriber receives Sequence 4 *before* the replay loop finishes dispatching Sequences 2 and 3.
3. **Sequence Ordering Violation**: The client receives events in order `[4, 2, 3]`. This breaks the core guarantee of strictly monotonic delivery.
4. **Duplicate Dispatch**: Because `handleJoinTeam` in Round 3 lacked an idempotency guard, calling `handleJoinTeam` during reconnect on an existing client registered a second adapter instance, causing duplicate event emissions (`[4, 2, 3, 4]`).

#### Execution Output from Reproduction Harness
```text
--- TEST 2: Reproducing Reconnection Replay Out-of-Order Race Condition ---
[RECONNECT] Client reconnecting with lastSequenceNumber = 1 (expecting seq 2, 3)...
[RACE_SIMULATION] Simulating concurrent event published during replay phase...
[RECEIVED_SEQUENCE] Observed sequence numbers at client: [4, 2, 3, 4]
[CONFIRMED_DEFECT_2] OUT-OF-ORDER REPLAY REPRODUCED: Live event (seq 4) arrived BEFORE replayed events (seq 2, 3)!
```

---

## 3. Root Cause: Why Did Repeated Refinement Produce Regressions?

### The Context Pollution Anatomy
The agent that wrote Round 3 was neither malicious nor incompetent. It fell victim to **mechanic context pollution**:
1. **Accumulated Multi-Turn Noise**:
   The conversation context contained:
   - Round 1 code (DB triggers and basic socket).
   - Prompt 1 critique and decision to discard.
   - Round 2 code (NestJS gateway, Pub/Sub service, JWT handshake).
   - Prompt 2 instructions (add heartbeats, add replay buffer, handle disconnections).
2. **Local Feature Optimization vs. Global Invariants**:
   When instructed to "add a heartbeat ping/pong mechanism," the LLM optimized locally for the heartbeat specification:
   - *"If client fails to respond, close connection with 4008."*
   - It implemented the standard ping-pong boolean toggle pattern without considering that in an activity feed, the client is primarily an event sink.
   - It did not wire downlink event dispatch into the activity timestamp refresher (`lastActiveAt`).
3. **Loss of Holistic Architectural Cohesion**:
   As code is patched piecemeal, subtle temporal couplings (such as the race condition between live room subscription and historical buffer replay) are easily overlooked by the model because the original clean architectural frame is buried under dozens of lines of conversational feedback.

---

## 4. Why Earlier Tests Failed to Catch the Regressions

| Defect | Why Earlier Test Suite Passed | What Was Missing in Verification |
|---|---|---|
| **Silent Disconnection (Defect 1)** | Earlier tests tested `handleHeartbeat()` directly (client sends ping, gets pong), or tested an intentional zombie that was aged artificially by 45 seconds (`lastActiveAt = Date.now() - 45000`). | The test never evaluated an active listener sitting through two consecutive sweep intervals without sending client frames. It tested unit methods in isolation rather than time-delayed lifecycle integration. |
| **Reconnection Inversion (Defect 2)** | Earlier tests executed synchronously in a single thread: disconnect client, publish event, reconnect client, inspect buffer. | The test did not simulate concurrent traffic occurring *during* the reconnection handshake. Real-time distributed systems only expose concurrency bugs under interleaved multi-producer workloads. |

---

## 5. Confirmed Defects vs. Hypothetical Risks

### Confirmed Defects (Empirically Demonstrated)
1. **Heartbeat Sweep Passive Eviction**: Verified in `repro-spiral.js`. A passive listener receiving events is forcibly closed with code `4008` after two sweep cycles.
2. **Reconnection Replay Race Condition**: Verified in `repro-spiral.js`. Concurrent events published during the replay phase are received ahead of replayed events, violating monotonicity.

### Hypothetical / Scaling Risks (Requiring Future Architecture)
1. **Single-Node In-Memory State**: If the NestJS gateway scales horizontally to multiple containers behind a load balancer, in-memory Maps will not share state. This requires an external Redis Pub/Sub adapter.
2. **Reconnection Storms**: If thousands of clients disconnect simultaneously (e.g. server restart), replaying buffers concurrently could cause a memory and network spike. Needs backoff and rate-limiting.

---

## 6. Commitment to Protocol & Next Steps

In strict accordance with the course constraints:
- **No Remediation in Step 5**: The codebase has NOT been rewritten or patched in this turn. All failing evidence has been preserved.
- **Evidence Files Preserved**:
  - `progress/evidence/module-05/repro-spiral.js`
  - `progress/evidence/module-05/spiral-repro-log.txt`
  - `progress/evidence/module-05/break-analysis.md`
- **Application Code Untouched**: Production code in `api/src/` remains untouched.
- Remediation will take place in **STEP 6: FIX** using a clean, targeted prompt.
