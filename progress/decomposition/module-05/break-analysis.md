# SkillSwap — The Technically Correct Disaster & Break Analysis (Module 05 Step 5)

## 1. Incident Diagnosis: When Passing Acceptance Criteria Still Fails Production

### Context:
An autonomous AI coding agent was handed the task specification for creating the booking endpoint. The agent's output satisfied 100% of the ticket's explicit acceptance criteria:
- Valid payload returns HTTP 201.
- Invalid data returns HTTP 400.
- Missing entities return HTTP 404.
- Contention returns HTTP 409.
- Data persists in PostgreSQL.

Despite passing all functional tests, the resulting implementation was unusable in production due to four severe operational and security gaps:
1. **Critical IDOR Vulnerability:** Accepted raw `user_id` from the unauthenticated JSON request body, allowing arbitrary impersonation.
2. **Denial-of-Service / Abuse Exposure:** Zero rate limiting; an unauthenticated bot can flood 10,000 bookings per second.
3. **Information Disclosure:** Unhandled exceptions (database connection drops, syntax errors) bubbled up as HTTP 500 containing raw SQL queries and internal stack traces.
4. **Zero Operational Observability:** Zero structured logs, correlation IDs, or audit trail events.

---

## 2. Root Cause Analysis
The root cause was **specification omission caused by implicit assumptions**:
- The author understood that identity must be trusted, rate limits must exist, and errors must be sanitized.
- However, none of these requirements were written into the ticket or explicitly bound to a shared standard.
- An autonomous AI agent (or external contractor) does not possess implicit project context. **If an invariant is not in the contract or in an explicitly referenced standard, it does not exist.**

---

## 3. Local Ticket Requirements vs. Project-Wide Engineering Standards

To prevent ticket bloat while ensuring non-negotiable security and reliability, requirements must be triaged across two distinct layers:

### A. Endpoint-Specific Requirements (Must Be in Individual Ticket):
- **Identity Derivation:** Explicit declaration that `learner_id` MUST be extracted from the authenticated JWT session context (`req.user.id`), strictly prohibiting client-supplied identity overrides in the request body.
- **Resource Ownership & Auth Guards:** Specific role requirement (e.g., `@UseGuards(JwtAuthGuard)` requiring `role = 'LEARNER'`).
- **Domain Audit Events:** Exact audit payload schema emitted upon successful booking (e.g., `audit.emit('booking.created', { booking_id, provider_id, slot_id, learner_id })`).

### B. Project-Wide Engineering Standards Document (Referenced by All Tickets):
- **Global Error Handling & Sanitization:** Centralized exception filter intercepting unhandled 500 errors, logging internal stack traces securely, and returning a generic opaque envelope `{ "error": { "code": "INTERNAL_SERVER_ERROR", "message": "An unexpected error occurred.", "trace_id": "uuid" } }`.
- **Global Rate Limiting:** Standard rate-limiting tiers (e.g., Tier 1: 60 req/min for public browse, Tier 2: 10 req/min for state-mutating booking/auth).
- **Structured Logging:** Standard JSON logging format with mandatory `trace_id`, `timestamp`, `level`, `service`, and `user_id`.

**The Architectural Rule:**
> *"Silence is not a reference. A ticket cannot rely on unstated assumptions. It must either specify the requirement locally or explicitly declare: 'Adhere to Project-Wide Standards Doc Sec 3.2 (Error Sanitization) and Sec 4.1 (Rate Limiting).'"*

---

## 4. Scope Impact Analysis
Introducing these constraints does **not** inflate individual tickets from 2 hours to 2 days, provided cross-cutting concerns are implemented once as shared middleware:
- Instead of re-implementing error handling or rate limiters inside every route, the ticket simply specifies:
  - `Constraints: Apply global @RateLimit('booking_tier') and GlobalExceptionFilter.`
- This preserves the S-size complexity of individual task tickets while guaranteeing production-grade security and reliability.
