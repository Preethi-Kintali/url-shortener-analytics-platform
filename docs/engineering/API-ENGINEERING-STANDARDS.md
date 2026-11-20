# SkillSwap — API Engineering & Operational Standards

**Document Version:** 1.0.0  
**Effective Date:** 2026-11-20  
**Status:** MANDATORY — All task tickets and autonomous executors must adhere to these standards.

---

## 1. HTTP Protocol & Routing Conventions
- **Base Route Prefix:** All REST endpoints must be prefixed with `/api/v1/`.
- **Resource Naming:** Use plural kebab-case nouns for collections (e.g., `/api/v1/providers`, `/api/v1/provider-schedules`).
- **HTTP Methods:**
  - `GET`: Safe, idempotent reads. Must never mutate state.
  - `POST`: Non-idempotent creation or state transition actions (e.g. `/api/v1/bookings/:id/cancel`).
  - `PUT`: Complete idempotent resource replacement.
  - `PATCH`: Partial resource update.
  - `DELETE`: Idempotent resource removal.

---

## 2. Standardized Error Response Envelope
Every client error (`4xx`) and server error (`5xx`) must be returned in this canonical JSON schema. **Stack traces, raw SQL queries, and internal error instances must NEVER leak to the client.**

```json
{
  "error": {
    "code": "SLOT_UNAVAILABLE",
    "message": "The requested slot has already been booked by another user.",
    "request_id": "req_8f1a2c3b-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
    "details": [
      {
        "field": "slot_id",
        "issue": "Slot is in BOOKED status."
      }
    ]
  }
}
```

### Standard Error Code Taxonomy:
- `VALIDATION_ERROR` (400): Malformed payload or validation schema failure.
- `UNAUTHORIZED` (401): Missing, expired, or invalid authentication credentials.
- `FORBIDDEN` (403): Authenticated caller lacks permissions (e.g. provider booking own service, accessing another user's booking).
- `NOT_FOUND` (404): Resource ID does not exist.
- `CONFLICT` (409): State conflict, double-booking race condition, or idempotency payload mismatch.
- `TOO_MANY_REQUESTS` (429): Rate limit exceeded.
- `INTERNAL_SERVER_ERROR` (500): Sanitized catch-all for unexpected backend faults.

---

## 3. Shared Security & Middleware Invariants
1. **Identity & Authentication Guards:**
   - Identity MUST be derived exclusively from the verified JWT context (`req.user.id`).
   - Endpoints must NEVER accept or trust a client-supplied user ID in the request body for authenticated operations (Strict Anti-IDOR policy).
2. **Rate Limiting & Abuse Protection:**
   - Public browse tier: 60 requests/minute per IP.
   - State-mutating tier (auth/booking/payment): 10 requests/minute per IP/authenticated user. Returns HTTP 429 upon exhaustion.
3. **Input Sanitization & Output Encoding:**
   - All string inputs are treated as untrusted plain text.
   - Text inputs (e.g. `notes`, `bio`) must be normalized, trimmed, and length-bounded.
   - Frontend and email templates must use context-appropriate output encoding to prevent Stored XSS.
4. **Idempotency Standards:**
   - State-mutating endpoints (e.g. `POST /api/v1/bookings`) must support the `Idempotency-Key` header.
   - Replaying the identical key with identical payload returns the cached success response.
   - Replaying the key with a conflicting payload returns HTTP 409 `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`.

---

## 4. Observability & Audit Trail Standards
1. **Request Correlation:**
   - Inbound requests receive or generate an opaque `X-Request-ID` UUID passed down the call chain and attached to every log line and error response.
2. **Structured JSON Logging:**
   - Every log entry emits valid JSON with mandatory fields: `timestamp`, `level` (`DEBUG`, `INFO`, `WARN`, `ERROR`), `trace_id`, `service`, `endpoint`, and `message`.
   - **Data Redaction:** Passwords, tokens, credit card PANs, and PII must be automatically masked before writing to log streams.
3. **Audit Logging:**
   - State mutations (booking created, cancelled, refunded) must emit an audit event to `audit_logs` capturing `{ timestamp, actor_id, action, resource_id, metadata }`.

---

## 5. Database & Transaction Reliability Standards
1. **Transaction Boundaries:** Any multi-step mutation (e.g., slot lock + booking insertion) must execute inside an explicit atomic database transaction (`BEGIN ... COMMIT`).
2. **Money Representation:** All financial quantities must be stored as 64-bit integers in minor currency units (cents, e.g., $50.00 = 5000).
3. **Timestamps:** All database timestamps and API representations must be ISO-8601 UTC with timezone offset `Z` (`YYYY-MM-DDTHH:mm:ss.sssZ`).
