# Module 05: Iteration Patterns — STEP 6: FIX
## Recognize and Recover: Remediation of Heartbeat Lifecycle and Reconnection Race Conditions

**Course**: Upsk AI-Augmented Engineering (Practitioner Pack)  
**Module**: Module 05 — Iteration Patterns  
**Step**: STEP 6: FIX — Recognize and Recover  
**Remediated Components**: `ActivityFeedGateway` (`progress/evidence/module-05/activity-feed.gateway.ts`)  
**Strategy Applied**: Targeted Surgical Recovery  
**Verification Status**: All 17 Regression Assertions Passed & All 37 Full Test Suite Assertions Passed (100% Pass Rate)

---

## 1. Defect Reassessment & Root Cause Analysis

### Defect A: Heartbeat Lifecycle & Passive Listener Eviction

#### Architectural Trace
In a real-time event streaming feature, the traffic pattern is asymmetric: clients are primarily *event sinks* receiving team updates pushed from the server.
In the Round 3 refinement, the AI agent implemented heartbeat monitoring using a naive toggle pattern:
```typescript
// Buggy Round 3 logic
sweepInactiveClients(maxIdleMs = 30000) {
  for (const [clientId, client] of this.activeClients.entries()) {
    if (now - client.lastActiveAt > maxIdleMs || !client.isAlive) {
      this.handleDisconnect(clientId, 4008);
    } else {
      client.isAlive = false;
    }
  }
}
```
#### Why It Broke
1. The server never issued explicit Ping control frames; it only checked `client.isAlive`.
2. When the sweep executed, it set `client.isAlive = false`.
3. In downlink event delivery, `subscriberAdapter.send(event)` dispatched `activity_event` but did not reset `client.isAlive` or send a Ping request.
4. **Critical Engineering Principle**: Server-side event delivery must **not** automatically count as proof that a client is alive. In TCP/WebSocket connections, writing to a socket buffer can succeed even when the client process is frozen, dead, or disconnected in a half-open state. Only an explicit, round-trip client response proves liveness.
5. Consequently, because the server did not emit a Ping and the client had no trigger to respond, on the very next sweep cycle `!client.isAlive` evaluated to `true`, evicting healthy passive listeners with close code `4008`.

#### Targeted Fix
1. Transmit explicit `ping` control frames from the server during each sweep cycle.
2. Mark `client.isAlive = false` upon issuing the `ping`.
3. Provide `handlePong(clientId)`: when the client responds to the `ping`, reset `client.isAlive = true` and update `lastActiveAt = Date.now()`.
4. Only evict clients when `client.isAlive` remains `false` across the full heartbeat interval (meaning the client failed to respond to the previous ping) or if `now - client.lastActiveAt > maxIdleMs`.
5. Maintain strict protocol separation: passive event delivery does **not** reset `client.isAlive`.

---

### Defect B: Reconnection Replay Ordering & Staging Queue

#### Architectural Trace
When a disconnected client reconnects, two event streams must be reconciled:
1. Historical missed events from the in-memory ring buffer (since `lastSequenceNumber`).
2. Real-time events occurring concurrently while the reconnection handshake and replay are in progress.

In the Round 3 refinement, `handleReconnect()` immediately registered the client into `teamSubscribers` via `handleJoinTeam()`, and *then* iterated over `activityFeedService.getEventsSince()`.

#### Why It Broke
1. If any concurrent event (e.g. Sequence 4) was published on the team channel while the server was executing the replay loop for historical events (e.g. Sequences 2 and 3), the real-time subscriber adapter immediately emitted Sequence 4 to the client socket.
2. The replay loop then delivered Sequences 2 and 3.
3. The client received events in the corrupted order: `[seq 4, seq 2, seq 3]`.
4. Monotonic sequence ordering was broken, and in some interleavings, events were delivered twice (once via live dispatch and once via buffer replay).

#### Targeted Fix: Staging Queue / Replay Gate
1. Attach the subscriber adapter to the live team channel **first** to ensure zero events are lost during the transition window.
2. Equip the subscriber adapter with an internal `stagingQueue` and a gate flag `isReplaying = true`.
3. While `isReplaying` is active, any concurrent live events are pushed into `stagingQueue` instead of being emitted immediately to the socket.
4. Fetch historical missed events from `ActivityFeedService` and deliver them sequentially in chronological order, recording `maxDeliveredSeq`.
5. Flush the `stagingQueue` in sequence order, deduplicating any events where `stagedEvt.sequenceNumber <= maxDeliveredSeq`.
6. Set `isReplaying = false`. All subsequent real-time events bypass the staging queue and emit directly to the client socket.

---

## 2. Corrective Implementation Code

File: `progress/evidence/module-05/activity-feed.gateway.ts`

```typescript
  // 3. Reconnection & Missed Event Replay with Staging Queue
  handleReconnect(
    clientId: string,
    teamId: string,
    lastSequenceNumber: number,
  ): { success: boolean; replayedEventsCount: number; historyTruncated: boolean; error?: string } {
    const client = this.activeClients.get(clientId);
    if (!client || !client.userId) {
      return { success: false, replayedEventsCount: 0, historyTruncated: false, error: 'UNAUTHENTICATED_CLIENT' };
    }

    const authorized = this.membershipStore.isMember(teamId, client.userId);
    if (!authorized) {
      client.emit('error', {
        error: { code: 'FORBIDDEN', message: `User '${client.userId}' is not a member of team '${teamId}'` },
      });
      return { success: false, replayedEventsCount: 0, historyTruncated: false, error: 'FORBIDDEN' };
    }

    // Clean up any stale subscription for this team on this client
    if (client.subscribedTeams.has(teamId)) {
      const existingAdapter = this.subscriberAdapters.get(`${client.id}_${teamId}`);
      if (existingAdapter) {
        this.activityFeedService.unsubscribe(teamId, existingAdapter);
        this.subscriberAdapters.delete(`${client.id}_${teamId}`);
      }
    }

    // Staging queue to hold concurrent live events arriving during replay phase
    const stagingQueue: ActivityEvent[] = [];
    let isReplaying = true;

    const stagedAdapter: IActivityFeedSubscriber = {
      clientId: client.id,
      teamId,
      send: (event: ActivityEvent) => {
        if (isReplaying) {
          stagingQueue.push(event);
        } else {
          client.emit('activity_event', event);
        }
      },
    };

    // Attach staged adapter to live feed BEFORE fetching historical buffer
    this.subscriberAdapters.set(`${client.id}_${teamId}`, stagedAdapter);
    this.activityFeedService.subscribe(teamId, stagedAdapter);
    client.subscribedTeams.add(teamId);

    // Fetch missed events from historical buffer
    const { events: missedEvents, historyTruncated } = this.activityFeedService.getEventsSince(
      teamId,
      lastSequenceNumber,
    );

    let maxDeliveredSeq = lastSequenceNumber;

    // Deliver historical events in chronological order
    for (const evt of missedEvents) {
      client.emit('activity_event', evt);
      if (evt.sequenceNumber > maxDeliveredSeq) {
        maxDeliveredSeq = evt.sequenceNumber;
      }
    }

    // Flush staging queue in sequence order, deduplicating any overlapping events
    for (const stagedEvt of stagingQueue) {
      if (stagedEvt.sequenceNumber > maxDeliveredSeq) {
        client.emit('activity_event', stagedEvt);
        maxDeliveredSeq = stagedEvt.sequenceNumber;
      }
    }

    isReplaying = false;

    client.emit('reconnect_complete', {
      teamId,
      replayedCount: missedEvents.length,
      historyTruncated,
      currentSequence: maxDeliveredSeq,
    });

    return { success: true, replayedEventsCount: missedEvents.length, historyTruncated };
  }

  // 4. Heartbeat Protocol: ping / pong
  handlePong(clientId: string): boolean {
    const client = this.activeClients.get(clientId);
    if (!client) return false;

    client.isAlive = true;
    client.lastActiveAt = Date.now();
    return true;
  }

  handleHeartbeat(clientId: string): boolean {
    const client = this.activeClients.get(clientId);
    if (!client) return false;

    client.isAlive = true;
    client.lastActiveAt = Date.now();
    client.emit('pong', { timestamp: client.lastActiveAt });
    return true;
  }

  // Sweeps inactive zombie connections & broadcasts ping control frames
  sweepInactiveClients(maxIdleMs = 30000): number {
    const now = Date.now();
    let disconnectedCount = 0;

    for (const [clientId, client] of this.activeClients.entries()) {
      if (!client.isAlive || now - client.lastActiveAt > maxIdleMs) {
        this.handleDisconnect(clientId, 4008);
        disconnectedCount++;
      } else {
        client.isAlive = false;
        client.emit('ping', { timestamp: now });
      }
    }

    return disconnectedCount;
  }
```

---

## 3. Verification & Regression Evidence

### 1. Dedicated Targeted Regression Suite (`test-fix-regressions.js`)
Command: `node progress/evidence/module-05/test-fix-regressions.js`  
Result: **17 of 17 assertions passed**.

Key Scenarios Verified:
- **Healthy Client Resilience**: Client responding to `ping` frames with `handlePong()` stays connected across multiple sweep cycles with 0 evictions.
- **Passive Delivery Integrity**: Streaming downlink events to a passive client does **not** falsely mark the client alive.
- **True Zombie Eviction**: Clients that fail to respond with `pong` are evicted with close code `4008`.
- **Subscription Teardown**: Evicted clients are cleanly removed from `ActivityFeedService` subscriber sets.
- **Concurrent Replay Ordering**: Concurrent live events arriving during the replay phase are queued in the staging buffer and delivered strictly *after* historical events in monotonic order (`[1, 2, 3]`).
- **Zero Duplicate Events**: Events delivered during staging are deduplicated (`sequenceNumber > maxDeliveredSeq`).
- **Tenant Isolation**: Sockets remain isolated by team during replay.

### 2. Full Regression Suite (`test-activity-feed.js`)
Command: `node progress/evidence/module-05/test-activity-feed.js`  
Result: **37 of 37 assertions passed** across all 7 technical requirements (handshake auth, team authorization, concurrency, sequence ordering, buffer capping at 50, deep recursive secret redaction, and malformed parameter validation).

### 3. Demonstration of Fix on BREAK Reproduction Harness (`verify-spiral-fix.js`)
Command: `node progress/evidence/module-05/verify-spiral-fix.js`  
Output Log: `progress/evidence/module-05/spiral-fix-verification.txt`  
- Test 1 (Heartbeat): Active user received events, responded to pings, and remained connected across 2 consecutive sweep cycles (Evicted: 0).
- Test 2 (Replay Ordering): Concurrent event `seq: 4` fired while replaying missed events `seq: 2, 3`. Delivered sequence was `[2, 3, 4]`, resolving out-of-order delivery.

---

## 4. Before / After Comparison Table

| Metric / Scenario | BREAK Step (Before FIX) | FIX Step (After Remediation) |
|---|---|---|
| **Passive Listener Connection** | Silently closed with code `4008` after 2nd sweep cycle | Remains connected indefinitely as long as Pong responses are returned |
| **Downlink Event State Impact** | Missing ping frame emission caused passive listeners to be assumed dead | Server emits explicit Ping frames; Pong responses verify true socket liveness |
| **Zombie Client Handling** | Conflated passive listeners with zombies | Genuinely dead clients failing to respond to Ping are evicted with code `4008` |
| **Concurrent Event During Replay** | Live events arrived out of order (`[seq 4, seq 2, seq 3]`) | Live events held in staging buffer; delivered in strict sequence (`[seq 2, seq 3, seq 4]`) |
| **Duplicate Event Delivery** | Reconnection triggered double-dispatch (`[4, 2, 3, 4]`) | Zero duplicates; deduplicated via `maxDeliveredSeq` boundary filter |
| **Automated Assertions** | 2 confirmed regressions in reproduction harness | 17/17 targeted regression tests passed; 37/37 full suite tests passed |

---

## 5. Architectural Scope & Limitations

1. **In-Memory Pub/Sub Scope**: The components (`ActivityFeedGateway`, `ActivityFeedService`) operate in-memory as part of the course test harness in `progress/evidence/module-05/`.
2. **Production App Isolation**: The tracked git repository (`api/src/`) remains completely untouched, ensuring zero production regressions.
3. **Horizontal Scaling Requirement**: In a clustered production environment, distributing the staging queue and WebSocket connections requires an external message broker (e.g., Redis Streams or RabbitMQ).
