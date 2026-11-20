# SkillSwap — Rogue Agent Break Analysis (Module 06 Step 5)

## 1. Incident Summary: The Rogue Agent Defect
In parallel execution with autonomous AI agents, individual agents frequently produce code that achieves 100% test passes against local unit test suites while committing fatal interface contract violations that break cross-service integration at synchronization checkpoints.

During the execution of **Stream 2 (Agent 2 / Backend 2)** on branch `feat/booking-creation-api`, Agent 2 passed all localized functional tests but introduced two severe contract violations against the frozen interface specification:

---

## 2. Specific Contract Violations Diagnosed

### Violation 1: API Naming Convention Divergence (camelCase vs. snake_case)
- **Canonical Contract Requirement:** Contract B (`module-06-interface-contracts.md` lines 78–85) explicitly defines request payload fields in canonical `snake_case`:
  `{ "provider_id": "...", "service_id": "...", "slot_id": "...", "learner_name": "...", "learner_email": "..." }`.
- **Rogue Agent Implementation:** Agent 2 unilaterally authored `CreateBookingDto` in `camelCase`:
  `{ providerId, serviceId, slotId, learnerName, learnerEmail }`.
- **Root Cause:** The agent's LLM system prompt prioritized default TypeScript/NestJS style conventions over strict interface contract fidelity.

### Violation 2: State Machine Corruption & Domain Blurring
- **Canonical Contract Requirement:** Contract C (`module-06-interface-contracts.md` lines 122–125) requires the slot state mutation to set `status = 'BOOKED'`.
- **Rogue Agent Implementation:** Agent 2 executed:
  `UPDATE slots SET status = 'confirmed' ...` and `INSERT INTO bookings ... VALUES (..., 'confirmed')`.
- **Root Cause:** The agent blurred domain boundaries between the **Slot Availability State Machine** (`AVAILABLE` $\to$ `HELD` $\to$ `BOOKED`) and the **Booking Lifecycle State Machine** (`PENDING` $\to$ `CONFIRMED` $\to$ `CANCELLED`), inventing an invalid slot status (`'confirmed'`).

---

## 3. Blast Radius at the Synchronization Point (Checkpoint 2 & 3)

1. **Frontend Request Rejection (HTTP 400):**
   When Stream 3 (compliant frontend) calls `POST /api/v1/bookings` with valid snake_case payload, Agent 2's class-validator fails:
   ```json
   {
     "statusCode": 400,
     "message": ["slotId must be a UUID", "providerId must be a UUID", "serviceId must be a UUID"],
     "error": "Bad Request"
   }
   ```
   Learners are completely blocked from completing bookings.

2. **Database State Inconsistency & Availability Corruption:**
   Writing status `'confirmed'` into `slots` bypasses or violates database check constraints. Even if stored, Stream 1 queries `WHERE status = 'AVAILABLE'`, causing unbooked queries to behave unpredictably and corrupting business analytics.

3. **Silent Race Condition Vulnerability:**
   Agent 2's implementation failed to verify `rows_affected` after the conditional update. If two concurrent requests arrive, both could proceed to insert duplicate booking rows for the same slot!

---

## 4. Resolution Strategy for Step 6 (FIX)
1. **Preserve the Contract:** The canonical contract is frozen and authoritative. We will NOT mutate the contract to accommodate Agent 2's rogue code.
2. **Refactor Agent 2 DTO:** Update `CreateBookingDto` to enforce exact canonical snake_case properties (`provider_id`, `service_id`, `slot_id`, etc.).
3. **Correct Database Mutation:** Change slot update query to set `status = 'BOOKED'`.
4. **Enforce Atomicity & Mutex Check:** Inspect `rows_affected`: if `0`, abort transaction and return HTTP 409 `SLOT_UNAVAILABLE`.
5. **Contract Integration Tests:** Establish automated contract tests simulating Agent 3 $\to$ Agent 2 $\to$ Agent 1 to verify synchronization compliance.
