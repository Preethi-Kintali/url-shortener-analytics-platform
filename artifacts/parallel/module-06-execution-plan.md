# SkillSwap — Parallel Execution & Synchronization Plan (Module 06)

## 1. Team Allocation & Stream Mapping

```
+-----------------------------------------------------------------------------------+
|                        CENTRAL INTERFACE CONTRACT FREEZE                          |
|             (artifacts/contracts/module-06-interface-contracts.md)                |
+-----------------------------------------+-----------------------------------------+
                    |                                 |
                    v                                 v
+---------------------------------------+   +---------------------------------------+
| STREAM 1 (Agent 1 / Backend Dev 1)    |   | STREAM 3 (Agent 3 / Frontend Dev)     |
| Branch: feat/slot-availability-api    |   | Branch: feat/provider-profile-ui      |
| Ticket: TICK-03                       |   | Ticket: TICK-02 Client Components     |
+---------------------------------------+   +---------------------------------------+
                    |                                 |
                    | (Checkpoint 1 Sync)             | (Checkpoint 1 Sync)
                    v                                 v
+-----------------------------------------------------------------------------------+
|                      CHECKPOINT 1: Interface & Schema Contract Sign-off           |
+-----------------------------------------------------------------------------------+
                    |
                    v
+---------------------------------------+
| STREAM 2 (Agent 2 / Backend Dev 2)    |
| Branch: feat/booking-creation-api     |
| Ticket: TICK-04                       |
+---------------------------------------+
                    |
                    v
+-----------------------------------------------------------------------------------+
|                      CHECKPOINT 2: Mocked Contract Integration Gate               |
|            (Frontend mocks verified against Stream 1 & 2 contract responses)      |
+-----------------------------------------------------------------------------------+
                    |
                    v
+-----------------------------------------------------------------------------------+
|                      CHECKPOINT 3: Atomic End-to-End Database Merge               |
|            (All branches merged into main; end-to-end integration tests)          |
+-----------------------------------------------------------------------------------+
```

---

## 2. Checkpoint Synchronization Protocols

### Checkpoint 1: Interface & Schema Sign-Off (Day 1, 12:00 PM)
- **Goal:** Freeze entity keys, types, and error shapes across all streams.
- **Verification Gate:**
  - Stream 1, 2, and 3 verify that `provider_id` and `slot_id` are strictly UUID v4.
  - Slot status enum values locked to `'AVAILABLE'`, `'HELD'`, and `'BOOKED'`.
  - No stream is permitted to begin state-mutating implementation until Checkpoint 1 is signed.

### Checkpoint 2: Mocked Contract Integration Gate (Day 2, 2:00 PM)
- **Goal:** Validate client-server compatibility using mock fixtures before database integration.
- **Verification Gate:**
  - Frontend (Stream 3) integrates with a mock server emitting payloads matching Contract A and Contract B.
  - Verify that the frontend correctly renders slot status, formats dates, and handles HTTP 409 Conflict gracefully.

### Checkpoint 3: Atomic End-to-End Integration & Merge (Day 3, 4:00 PM)
- **Goal:** Merge all feature branches into `main` and execute end-to-end integration suite.
- **Verification Gate:**
  - Automated integration test seeds providers and slots, retrieves available slots via Stream 1 API, books a slot via Stream 2 API, verifies slot status is updated to `'BOOKED'`, and confirms the frontend view updates accordingly.
  - Concurrency drill: 20 simultaneous booking requests to a single slot must yield exactly 1 HTTP 201 and 19 HTTP 409s.
