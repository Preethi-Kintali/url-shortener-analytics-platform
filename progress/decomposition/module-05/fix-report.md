# SkillSwap — Specification Gaps Fix Report (Module 05 Step 6)

## 1. Executive Summary & Problem Resolution
Following our diagnosis of the "Technically Correct Disaster" in Step 5, we executed a rigorous specification refinement pass across our Module 05 task tickets. 

We established that **silence is not a reference**: an autonomous coding agent or remote engineer cannot be expected to infer security, operational, or data reliability standards that are not explicitly codified in the contract or bound to a shared standard.

We achieved complete specification rigor through a dual-level strategy:
1. **Endpoint-Specific Invariants (Updated in `TICK-04`):** Fixed three critical unstated assumptions (Network Retries/Idempotency, Plain-text Sanitization/Anti-XSS, and Self-Booking/Authorization Guards).
2. **Project-Wide Engineering Standards (`API-ENGINEERING-STANDARDS.md`):** Authored a central standard defining canonical HTTP error envelopes, rate-limiting tiers, structured JSON logging with correlation IDs, and transaction invariants, referenced across all tickets `TICK-01` through `TICK-06`.

---

## 2. Deep Dive: Three Unstated Assumptions Resolved in TICK-04

### Assumption 1: Idempotency on Network Retries
- **Vulnerability:** Mobile network instability can cause clients to drop connections after the server commits a booking. When the client automatically retries, a second booking is created or the caller receives an error even though their booking succeeded.
- **Specification Fix:**
  - Added optional `Idempotency-Key` header support.
  - Required atomic persistence of `{ idempotency_key, request_hash, response_payload, created_at }`.
  - Replays of identical payloads return the original HTTP 201 response.
  - Reusing an existing key with a mismatched payload returns HTTP 409 `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`.

### Assumption 2: Plain-Text Sanitization & Anti-XSS in `notes`
- **Vulnerability:** A malicious actor could inject `<script>` tags or HTML into `notes`. If the provider dashboard or email notification renders this string unsafely, Stored XSS results.
- **Specification Fix:**
  - Explicitly classified `notes` as untrusted plain text.
  - Enforced a strict 1,000-character upper bound (returns HTTP 400 `VALIDATION_ERROR` on violation).
  - Normalized empty strings and whitespace-only inputs to SQL `NULL`.
  - Mandated context-appropriate HTML entity encoding prior to rendering in UI and email views.

### Assumption 3: Self-Booking & Learner Authorization Guards
- **Vulnerability:** A registered provider could book their own calendar slots to manipulate marketplace metrics, or an unauthenticated user could supply arbitrary learner IDs.
- **Specification Fix:**
  - Enforced derivation of user identity strictly from the authenticated JWT session context (`req.user.id`).
  - Added business authorization check: if `req.user.provider_id == body.provider_id`, the system immediately rejects the transaction with HTTP 403 `FORBIDDEN_SELF_BOOKING`.
  - Emitted structured audit event `audit.emit('booking.created', { booking_id, provider_id, slot_id, learner_id, timestamp })`.

---

## 3. The Central Standards Contract: `API-ENGINEERING-STANDARDS.md`
To eliminate redundant boilerplate while guaranteeing baseline quality, we authored [`docs/engineering/API-ENGINEERING-STANDARDS.md`](../../docs/engineering/API-ENGINEERING-STANDARDS.md), covering:
- **Consistent Error Envelope:** Standard schema returning `error.code`, `error.message`, and `error.request_id` for all 4xx/5xx responses; strict prohibition against raw SQL leaks or stack trace exposure.
- **Security & Middleware:** Global rate-limiting tiers (60 req/min browse, 10 req/min mutation), JWT auth guards, and Anti-IDOR enforcement.
- **Observability:** Structured JSON logs containing `timestamp`, `level`, `trace_id`, `service`, and automatic PII redaction.
- **Database Reliability:** Explicit transaction boundaries (`BEGIN ... COMMIT`), integer cent monetary representations, and ISO-8601 UTC timestamps.

---

## 4. The Completeness Checklist Audit Across TICK-01 to TICK-06

| Completeness Question | Audit Finding | Verification Status |
|---|---|:---:|
| **Does every endpoint specify every status code?** | Yes: 200, 201, 400, 401, 403, 404, 409, 429, 500 fully mapped. | **VERIFIED** |
| **Does every request body specify required vs. optional?** | Yes: All JSON bodies annotate field types, required flags, and bounds. | **VERIFIED** |
| **Does every response body show exact JSON shape?** | Yes: Full typed JSON response envelopes provided for every route. | **VERIFIED** |
| **Does every ticket state auth/authorization requirements?** | Yes: Explicitly declared as public or protected by JWT guards. | **VERIFIED** |
| **Does every ticket specify unexpected error handling?** | Yes: Centralized sanitization returning generic 500 with request trace ID. | **VERIFIED** |
| **Does every ticket's output match the next ticket's input?** | Yes: Seed IDs in TICK-01 flow seamlessly into TICK-02/03/04; JWT claims in TICK-05 flow into TICK-06. | **VERIFIED** |
