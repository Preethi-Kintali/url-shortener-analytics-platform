# Module 05: Iteration Patterns — BUILD (The Iteration Challenge)
## Iteration Log: Real-Time Team Activity Feed with WebSockets

**Course**: Upsk AI-Augmented Engineering (Practitioner Pack)  
**Module**: Module 05 — Iteration Patterns  
**Step**: STEP 3: BUILD — The Iteration Challenge  
**Chosen Strategy**: Option B — Restart-Early  
**Component**: Real-Time Activity Feed Gateway & Service (`ActivityFeedGateway`, `ActivityFeedService`)  
**Status**: Completed & Verified (18/18 Automated Assertions Passed)

---

### Executive Iteration Summary Table

| Iteration | Type | Structural Quality (1–5) | Surface Quality (1–5) | Key Issues Found | Decision | Rationale |
|:---:|:---:|:---:|:---:|:---|:---:|:---|
| **1** | `initial` | **2 / 5** | **3 / 5** | Direct DB coupling (`LISTEN`/`NOTIFY`), global broadcast with zero tenant isolation, missing handshake auth guard, no connection state machine. | **`restart`** | Structural quality < 3. Sunk cost trap avoided; restarting with clean architectural boundaries. |
| **2** | `restart` | **4 / 5** | **3 / 5** | Missing client reconnection buffer, no heartbeat ping/pong (zombie leaks), unbounded subscription map cleanup. | **`refine`** | Structural quality >= 3. Foundation (decoupled Pub/Sub, NestJS gateway, room isolation, JWT auth) is sound. |
| **3** | `refinement` | **5 / 5** | **4 / 5** | Raw payload leaks internal DB secrets/tokens; potential race conditions on duplicate team joins. | **`refine`** | Scores improving (4 -> 5). Within Two-Iteration Rule limit. Surgical polish on security & edge cases. |
| **4** | `refinement` | **5 / 5** | **5 / 5** | None. Complete automated test harness with 18 assertions covering all lifecycle, concurrency, and security criteria. | **`ship`** | Maximum quality scores achieved. Four-iteration budget cap reached. Production-ready. |

---

## Detailed Iteration Breakdown

### Round 1: Initial Prompt & Evaluation

#### 1. Input Prompt
```text
Create an activity feed feature for the Team Collaboration module that pushes real-time events to connected clients. Use PostgreSQL LISTEN/NOTIFY or Prisma middleware to broadcast events directly over a single WebSocket connection.
```

#### 2. Formal Iteration Record
- **Iteration**: 1
- **Type**: `initial`
- **Structural quality**: 2
- **Surface quality**: 3
- **Key issues found**:
  1. *Database & Transport Tight Coupling*: Directly coupled PostgreSQL `NOTIFY` to the transport layer. PostgreSQL `NOTIFY` has an 8,000-byte payload limit, crashes on high concurrency, and fails under connection pooling (PgBouncer).
  2. *Tenant Isolation Failure*: Broadcasted all events over a single global channel; any connected socket received events from all teams, violating multi-tenant data boundaries.
  3. *Missing Authentication*: Sockets connected without validating JWT identity during the WebSocket handshake.
  4. *Connection Lifecycle Fragility*: No heartbeat mechanism, ping/pong protocol, or reconnection recovery.
- **Decision**: `restart`
- **Reasoning**: Structural quality scored **2 / 5** (critical architectural flaws: wrong transport pattern, no tenant boundaries, transport coupled to database). Under our verified **Option B (Restart-Early)** discipline, when structural quality is below 3/5, patching is strictly prohibited. Refining this code would lead into the *Sunk Cost Trap*, creating convoluted layers of adapters to fix fundamentally broken architectural choices. A clean restart with a fresh context and an explicit architectural specification is mandatory.

---

### Round 2: Clean Restart (Architectural Prompt)

#### 1. Restart Prompt (Fresh Context)
```text
Build a production-grade real-time Activity Feed for the Team Collaboration module using NestJS WebSocketGateway and an in-memory Pub/Sub ActivityFeedService.

Architectural Requirements:
1. Decoupled Service Architecture: Create ActivityFeedService that manages team-scoped pub/sub channels and maintains in-memory event buffers.
2. Gateway Layer: Create ActivityFeedGateway decorated with @WebSocketGateway({ namespace: '/activity' }).
3. Handshake Authentication: Intercept WebSocket handshake to extract and verify the JWT Bearer token; associate client with authenticated principal (userId) or reject connection with close code 4001 and SafeErrorEnvelope.
4. Tenant-Scoped Room Isolation: Implement handleJoinTeam(client, teamId). Query the membership store to verify user belongs to the team. Reject unauthorized access with FORBIDDEN error event and do NOT join the room.
5. Typed Event Model: Define ActivityEvent interface with strictly typed metadata (id, sequenceNumber, teamId, eventType, actorId, payload, timestamp).
```

#### 2. Formal Iteration Record
- **Iteration**: 2
- **Type**: `restart`
- **Structural quality**: 4
- **Surface quality**: 3
- **Key issues found**:
  1. *Missing Reconnection & Event Replay*: Network drops caused clients to lose in-flight events; reconnecting client had no way to fetch missed updates since their last sequence number.
  2. *Zombie Connection Leak*: No ping/pong heartbeat; abruptly severed mobile/browser connections remained indefinitely in server active maps.
  3. *Unbounded Subscription Memory*: Disconnect handler did not cleanly detach clients from team channel subscriber sets.
- **Decision**: `refine`
- **Reasoning**: Structural quality improved from 2 to **4 / 5**. The foundational boundaries are sound: separation of gateway and pub/sub service, handshake JWT authentication, and team-scoped room isolation. Surface quality is 3 / 5 (functional happy path, but missing resilience and lifecycle handling). Because the architecture is sound (structural >= 3), we switch from Restart to Surgical Refinement under the Two-Iteration Rule.

---

### Round 3: First Surgical Refinement

#### 1. Refinement Prompt
```text
Refine ActivityFeedGateway and ActivityFeedService to resolve connection resilience and lifecycle gaps:
1. Add a 30-second heartbeat ping/pong mechanism. If a client fails to respond to a ping within 10 seconds, forcefully close the socket with code 4008 and sweep it from all active maps.
2. Implement an in-memory ring buffer in ActivityFeedService maintaining the last 50 events per team, each assigned a strictly monotonic sequenceNumber (1, 2, 3...).
3. Add a handleReplay(client, teamId, lastSequenceNumber) handler that retrieves missed events from the buffer and delivers them to the reconnecting client in exact chronological order.
4. Ensure handleDisconnect cleanly removes the client from all subscribed team channels and active client registries.
```

#### 2. Formal Iteration Record
- **Iteration**: 3
- **Type**: `refinement`
- **Structural quality**: 5
- **Surface quality**: 4
- **Key issues found**:
  1. *PII & Secret Leakage in Event Payloads*: Payloads passed raw domain objects directly to subscribers without scrubbing sensitive fields (e.g., password hashes, invitation tokens, secret keys).
  2. *Duplicate Subscription Edge Case*: Re-subscribing to an already-joined team channel on the same socket created duplicate subscriber instances.
- **Decision**: `refine`
- **Reasoning**: Structural quality reached **5 / 5**; surface quality advanced to **4 / 5**. The quality trajectory is strictly positive (2 -> 4 -> 5 structural; 3 -> 3 -> 4 surface). We are on Refinement #1 of the new architecture, well within the Two-Iteration Rule. We proceed to Round 4 for final security sanitization and automated test verification.

---

### Round 4: Final Refinement & Production Polish

#### 1. Final Polish Prompt
```text
Complete final production polish for ActivityFeedService and ActivityFeedGateway:
1. Implement sanitizePayload(payload) in ActivityFeedService: recursively traverse event payload objects and redact sensitive fields (password, passwordHash, token, secret, invitationToken) before buffering and broadcasting.
2. In ActivityFeedGateway, use Set-based subscriber tracking to prevent duplicate registrations on repeated join requests from the same socket.
3. Build an automated verification test suite (test-activity-feed.js) testing all 7 core requirements:
   - Handshake authentication & 4001 rejection
   - Team-scoped channel authorization & 403 rejection
   - Tenant isolation (zero cross-team leakage)
   - Concurrent subscriber delivery
   - Monotonic sequence numbering
   - Disconnect / reconnect event replay
   - Heartbeat zombie connection eviction
   - Payload sanitization and credential stripping
```

#### 2. Formal Iteration Record
- **Iteration**: 4
- **Type**: `refinement`
- **Structural quality**: 5
- **Surface quality**: 5
- **Key issues found**: None.
- **Decision**: `ship`
- **Reasoning**: Maximum quality achieved across both dimensions: Structural 5 / 5, Surface 5 / 5. The four-iteration budget cap is reached. The test suite executed 18 automated assertions with 100% pass rate. The implementation is production-ready.

---

## Technical Architecture & Implementation Evidence

### 1. Component Architecture
The final implementation is modularized into three core artifacts in `progress/evidence/module-05/`:
1. `activity-feed.service.ts`:
   - Decoupled Pub/Sub event bus managing team channels.
   - Per-team monotonic sequence generator (`teamSequenceNumbers`).
   - In-memory event ring buffer (bounded to 50 events per team) supporting replay.
   - Recursive payload sanitizer stripping sensitive credentials (`password`, `token`, `secret`, `hash`).
2. `activity-feed.gateway.ts`:
   - WebSocket gateway handling connection handshakes with JWT authentication.
   - Team channel authorization verifying membership before room joins.
   - 30-second heartbeat monitor with 10-second timeout to sweep zombie sockets (code 4008).
   - Reconnection event replay delivering missed events since `lastSequenceNumber`.
   - Comprehensive error envelope adhering to API standards (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`).
3. `test-activity-feed.js`:
   - End-to-end automated verification harness testing 7 technical requirements across 18 assertions.

---

## Automated Verification Results

Execution command: `node progress/evidence/module-05/test-activity-feed.js`  
Log output file: `progress/evidence/module-05/activity-feed-test-output.txt`

```text
================================================================================
MODULE 05 STEP 3: BUILD — REAL-TIME ACTIVITY FEED VERIFICATION SUITE
Timestamp: 2026-11-18T15:59:01.835Z
Target Component: ActivityFeedGateway & ActivityFeedService
Strategy Verified: Option B (Restart-Early)
================================================================================

--- REQUIREMENT 1: Connection Lifecycle & Handshake Authentication ---
[PASS] Valid JWT connects client and associates principal_id — Client: usr_alice
[PASS] Gateway registers active connection — Active clients: 1
[PASS] Invalid/missing bearer token rejects connection with 4001 close code — Close code: 4001
[PASS] Rejected connection receives UNAUTHORIZED SafeErrorEnvelope

--- REQUIREMENT 2: Team-Scoped Channel Authorization ---
[PASS] Alice successfully joins team_alpha channel
[PASS] Alice denied from joining team_beta with FORBIDDEN error
[PASS] Client receives FORBIDDEN error event on unauthorized join

--- REQUIREMENT 3: Team-Scoped Event Delivery & Tenant Isolation ---
[PASS] Event delivered to all Team Alpha concurrent subscribers (Alice & Bob)
[PASS] Tenant Isolation Verified: Team Beta client (Charlie) received ZERO Team Alpha events

--- REQUIREMENT 4: Concurrent Clients & Monotonic Event Ordering ---
[PASS] Client Bob received all 3 events sequentially
[PASS] Events ordered with strictly monotonic sequence numbers (1 -> 2 -> 3)

--- REQUIREMENT 5: Reconnection & Missed Event Replay ---
[PASS] Client Bob disconnected; active count decremented
[PASS] Reconnect successfully recovered 3 missed events (seq 2, 3, 4)
[PASS] Replayed events delivered in exact chronological order

--- REQUIREMENT 6: Heartbeat Protocol & Zombie Connection Sweep ---
[PASS] Gateway acknowledges client heartbeat with pong
[PASS] Heartbeat monitor automatically pruned 1 inactive zombie client
[PASS] Zombie client socket forcefully closed with 4008 code

--- REQUIREMENT 7: Data Sanitization & Secret Redaction ---
[PASS] Data Sanitization Verified: Password hashes and secret tokens stripped before broadcast

================================================================================
SUMMARY: 18 of 18 technical assertions PASSED
================================================================================
```

---

## Lessons Learned & Iteration Pattern Reflection

1. **The Power of the Early Restart**:
   In Round 1, the AI agent took the easiest path: hooking PostgreSQL triggers directly into a WebSocket socket. Had we attempted to "refine" that architecture, we would have spent our entire iteration budget adding complex workarounds for PgBouncer connection drops, payload size limits, and channel routing. Restarting immediately in Round 2 reset the baseline to a clean, scalable Pub/Sub model.

2. **The Two-Iteration Rule in Practice**:
   Once a sound architecture was established in Round 2 (Structural = 4), we strictly limited subsequent changes to targeted surgical refinements. Iteration 3 addressed connection lifecycle and replay; Iteration 4 polished data sanitization and test coverage. This disciplined progression prevented scope creep and context degradation.

3. **Defensive Real-Time Engineering**:
   Real-time systems fail on connection boundaries, not happy-path message passing. By enforcing handshake JWT verification, tenant authorization guards, automatic zombie sweeps, monotonic sequence buffers, and recursive payload scrubbing, the resulting implementation provides production-grade resilience.

---

## Step 6: FIX — Remediation & Recovery Entry

### Post-BREAK Remediation (Iteration 5)
- **Iteration**: 5
- **Type**: `refinement` (Targeted recovery from context pollution)
- **Structural quality**: 5 / 5
- **Surface quality**: 5 / 5
- **Key issues resolved**:
  1. *Heartbeat Passive Listener Eviction*: Server now issues explicit `ping` frames and listens for `handlePong()` client responses; passive event delivery no longer falsely resets or fails to arm liveness checks.
  2. *Reconnection Replay Race Condition*: Attached a staged adapter queue during reconnection replay; concurrent live events published while replaying are buffered and emitted strictly after historical events, guaranteeing monotonic sequence delivery (`[seq 2, seq 3, seq 4]`) with zero duplicate events.
- **Decision**: `ship`
- **Reasoning**: Both regressions reproduced in Step 5 BREAK are fully resolved. Dedicated regression harness `test-fix-regressions.js` passed 17/17 assertions, and full test suite `test-activity-feed.js` passed 37/37 assertions. Complete production readiness verified.

