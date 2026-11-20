# SkillSwap — AI Agent Roleplay & Ticket Verification Report (Module 05 Step 4)

## 1. Context & Review Target
- **Ticket Evaluated:** [`TICK-04: POST /api/v1/bookings — Create Anonymous Booking & Confirm Slot`](../../../artifacts/tickets/module-05/TICK-04-post-bookings-anonymous.md)
- **Roleplay Persona:** Autonomous AI coding agent with zero prior codebase context attempting to produce correct, production-grade implementation on the first pass.

---

## 2. Evaluation & Classification of AI Agent Questions

### Question 1: Null vs. Empty String for Optional `notes` Field
- **Agent Question:** *"In the request payload, `notes` is optional (max 500 chars). If omitted or passed as `null`, should the database column store SQL `NULL` or an empty string `""`?"*
- **Classification:** **SPEC GAP**
- **Engineering Rationale:** Database column nullability and string normalization affect SQL query filters (e.g. `WHERE notes IS NOT NULL`), API serialization, and storage consistency across clients. Leaving this unspecified leads to inconsistent representations depending on client conventions.
- **Specification Resolution in TICK-04:**
  - Omitted, `null`, or whitespace-only strings are explicitly normalized to SQL `NULL`.
  - Non-empty strings are trimmed of leading/trailing whitespace.
  - Strict 500-character upper bound enforced, returning HTTP 400 `VALIDATION_ERROR` on violation.

---

### Question 2: Collision Handling & Character Set for `booking_reference`
- **Agent Question:** *"The spec requires `booking_reference` matching `^BK-[A-Z0-9]{6}$`. What exact retry policy should be implemented on collision, and should ambiguous characters like `0`/`O` and `1`/`I` be excluded?"*
- **Classification:** **SPEC GAP**
- **Engineering Rationale:** Booking references are human-facing identifiers communicated over email, phone, and receipts. Ambiguous characters cause high customer support burden (confusing `O` and `0`). Furthermore, undefined retry loops can either crash on first collision or loop infinitely.
- **Specification Resolution in TICK-04:**
  - Character set restricted to Crockford base32 alphabet: `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (excludes `0`, `O`, `1`, `I`).
  - Unique index on `bookings(booking_reference)`.
  - Bounded retry policy: up to 5 attempts on PostgreSQL unique constraint collision (`23505`). If all 5 attempts fail, transaction aborts, a critical alert is logged, and HTTP 500 is returned.

---

### Question 3: Concurrency Locking Strategy on Slot Update
- **Agent Question:** *"Should I use an explicit row lock (`SELECT ... FOR UPDATE`), a conditional update checking affected rows (`UPDATE slots SET status = 'BOOKED' WHERE id = :id AND status = 'AVAILABLE'`), or elevate the transaction isolation level to `SERIALIZABLE`?"*
- **Classification:** **LEGITIMATE IMPLEMENTATION DECISION**
- **Engineering Rationale:** The specific locking mechanism is an internal database implementation choice that depends on ORM capabilities, database engine nuances, and query execution plans. Prescribing the exact SQL command creates unnecessary micromanagement and prevents the executor from using idiomatic framework patterns.
- **Contract Boundary Maintained in TICK-04:**
  - The spec enforces the **behavioral invariant**: exactly one request must succeed in transitioning an available slot to `BOOKED` within an atomic transaction; any concurrent request must receive HTTP 409 `SLOT_UNAVAILABLE`.
  - The internal choice of mechanism (conditional row update vs. pessimistic lock) remains with the executor.

---

## 3. Red-Flag Audit Across All Module 05 Tickets

| Red-Flag Check | Audit Result | Evidence / Remediation |
|---|---|---|
| **Vague words ("appropriate", "properly")?** | **CLEAN** | Zero occurrences without mathematical/status code definitions. |
| **Ambiguous "the database"?** | **CLEAN** | All tickets specify PostgreSQL / SQLite, exact table schemas, and column constraints. |
| **Missing HTTP status codes?** | **CLEAN** | All endpoints specify explicit success (200, 201) and error codes (400, 401, 403, 404, 409, 500). |
| **Prose payload descriptions?** | **CLEAN** | Every request and response is modeled with a typed JSON payload block. |
| **Unspecified inter-ticket contracts?** | **CLEAN** | TICK-01 defines IDs used by TICK-02, TICK-03, and TICK-04; TICK-05 defines JWT claims consumed by TICK-06. |
