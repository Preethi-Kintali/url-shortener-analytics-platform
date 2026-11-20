# TICK-04: POST /api/v1/bookings — Create Anonymous Booking (AI-READY SPEC)

## 1. Title
`TICK-04: POST /api/v1/bookings — Create Anonymous Booking & Confirm Slot (AI-Ready)`

---

## 2. Context (Why)
This ticket delivers the core value exchange of SkillSwap's Slice 1 walking skeleton. After selecting a provider, service package, and an available slot on the frontend, the learner clicks "Book Now". This endpoint creates the persistent booking record, transitions the slot status from `AVAILABLE` to `BOOKED`, and returns a confirmation receipt with a generated human-readable booking reference number.

---

## 3. Scope (What)
- Implement a single HTTP `POST` endpoint at `/api/v1/bookings`.
- Create the `bookings` database table migration if not already present.
- Execute the booking creation inside an atomic database transaction:
  1. Validate request body fields and UUID formats.
  2. Verify that the requested `slot_id` exists, belongs to `provider_id`, and has `status = 'AVAILABLE'`.
  3. Update `slots.status` from `'AVAILABLE'` to `'BOOKED'`.
  4. Generate a unique human-friendly `booking_reference` (format: `BK-` followed by 6 alphanumeric characters, e.g. `BK-8F29A1`).
  5. Insert the new booking record into `bookings` with `status = 'CONFIRMED'`.
- Return HTTP 201 Created with the full booking payload on success.
- Return HTTP 400 for invalid inputs, 404 for missing entities, and 409 for slot conflict.

---

## 4. Interface Contract (Inputs/Outputs/Data Shapes)

### Database Table Schema:
```sql
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference VARCHAR(12) NOT NULL UNIQUE,
  provider_id UUID NOT NULL REFERENCES providers(id),
  service_id UUID NOT NULL REFERENCES services(id),
  slot_id UUID NOT NULL REFERENCES slots(id),
  learner_name VARCHAR(100) NOT NULL,
  learner_email VARCHAR(150) NOT NULL,
  notes VARCHAR(500),
  status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED', -- 'CONFIRMED', 'CANCELLED', 'REFUNDED'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bookings_reference ON bookings(booking_reference);
CREATE INDEX IF NOT EXISTS idx_bookings_slot_id ON bookings(slot_id);
```

### HTTP Request:
- **Method:** `POST`
- **Route:** `/api/v1/bookings`
- **Headers:** `Content-Type: application/json`
- **Request Body:**
```json
{
  "provider_id": "22222222-2222-2222-2222-222222222222",
  "service_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "slot_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01",
  "learner_name": "Jordan Lee",
  "learner_email": "jordan.lee@example.com",
  "notes": "Looking forward to reviewing system scaling bottlenecks."
}
```

### HTTP Response (201 Created):
```json
{
  "booking_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
  "booking_reference": "BK-8F29A1",
  "status": "CONFIRMED",
  "provider_id": "22222222-2222-2222-2222-222222222222",
  "service_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "slot_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01",
  "slot_time": {
    "start_time": "2026-11-21T10:00:00.000Z",
    "end_time": "2026-11-21T11:00:00.000Z"
  },
  "learner": {
    "name": "Jordan Lee",
    "email": "jordan.lee@example.com"
  },
  "created_at": "2026-11-20T17:50:00.000Z"
}
```

### HTTP Error Responses:
- **400 Bad Request:** Missing required fields or invalid format:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "learner_email must be a valid email address.",
    "field": "learner_email"
  }
}
```
- **404 Not Found:** Referenced provider, service, or slot does not exist:
```json
{
  "error": {
    "code": "ENTITY_NOT_FOUND",
    "message": "The specified slot_id does not exist."
  }
}
```
- **409 Conflict:** The slot is already booked:
```json
{
  "error": {
    "code": "SLOT_UNAVAILABLE",
    "message": "The requested time slot has already been booked by another user."
  }
}
```

---

## 5. Acceptance Criteria (Given / When / Then)

### Scenario 1: Successful Anonymous Booking
- **Given** Provider Marcus has an available slot `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01`,
- **When** a client sends `POST /api/v1/bookings` with a valid body containing Marcus's `provider_id`, `service_id`, `slot_id`, `learner_name`, and `learner_email`,
- **Then** the server responds with HTTP status `201 Created`,
- **And** the response body contains a unique `booking_reference` matching regex `^BK-[A-Z0-9]{6}$`,
- **And** the booking record exists in `bookings` with `status = 'CONFIRMED'`,
- **And** the corresponding slot in `slots` now has `status = 'BOOKED'`.

### Scenario 2: Double-Booking Prevention (Conflict)
- **Given** a slot already has `status = 'BOOKED'`,
- **When** any client sends `POST /api/v1/bookings` referencing that same `slot_id`,
- **Then** the server responds with HTTP status `409 Conflict`,
- **And** the error payload code is `"SLOT_UNAVAILABLE"`,
- **And** no new record is inserted into `bookings`.

### Scenario 3: Validation Error on Missing Fields
- **When** a client sends `POST /api/v1/bookings` with `learner_email` missing or empty,
- **Then** the server responds with HTTP status `400 Bad Request`,
- **And** the error payload code is `"VALIDATION_ERROR"`.

### Scenario 4: Non-Existent Entity
- **When** a client sends `POST /api/v1/bookings` with a non-existent `service_id`,
- **Then** the server responds with HTTP status `404 Not Found`,
- **And** the error payload code is `"ENTITY_NOT_FOUND"`.

### Scenario 5: Idempotency on Network Retries
- **Given** an initial booking request succeeded with `Idempotency-Key: idemp-123`,
- **When** the client resends the exact same `POST /api/v1/bookings` payload with identical `Idempotency-Key: idemp-123`,
- **Then** the server returns the cached HTTP 201 response with the original `booking_reference`,
- **And** no duplicate booking or slot mutation occurs.

### Scenario 6: Reusing Idempotency Key with Divergent Payload
- **Given** an initial booking completed with `Idempotency-Key: idemp-123`,
- **When** another request submits a different payload using `Idempotency-Key: idemp-123`,
- **Then** the server responds with HTTP status `409 Conflict`,
- **And** the error payload code is `"IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"`.

### Scenario 7: Self-Booking Prevention Guard
- **Given** an authenticated user whose `provider_id` matches the provider being booked,
- **When** the provider attempts to submit a booking for their own session,
- **Then** the server responds with HTTP status `403 Forbidden`,
- **And** the error payload code is `"FORBIDDEN_SELF_BOOKING"`.

---

## 6. Constraints & Engineering Standards (Rules to Follow)
- **Mandatory Standards Reference:** All implementation must adhere strictly to [`docs/engineering/API-ENGINEERING-STANDARDS.md`](../../docs/engineering/API-ENGINEERING-STANDARDS.md).
- **Global Error Envelope & Stack Traces:** All exceptions must be intercepted by the global exception filter; raw database errors or stack traces must never reach the response body.
- **Idempotency Invariant (Assumption 1):**
  - Accept optional `Idempotency-Key: <uuid>` header.
  - Store request hash and response payload atomically in `idempotency_records`. Replays within 24 hours return the cached response; payload mismatches return HTTP 409.
- **Plain-Text Sanitization & Anti-XSS (Assumption 2):**
  - Treat `notes` strictly as untrusted plain text.
  - Trim leading/trailing whitespace; normalize empty or whitespace-only inputs to SQL `NULL`.
  - Enforce maximum 1,000 characters (return HTTP 400 `VALIDATION_ERROR` if exceeded).
  - Consumers must apply context-aware HTML entity encoding prior to rendering in web/email views.
- **Authorization & Self-Booking Guard (Assumption 3):**
  - If authenticated, derive user identity exclusively from session JWT context (`req.user.id`).
  - Prohibit self-booking: return HTTP 403 `FORBIDDEN_SELF_BOOKING` if `req.user.provider_id == body.provider_id`.
  - Emit structured audit event `audit.emit('booking.created', { booking_id, provider_id, slot_id, learner_email, timestamp })`.
- **Database Transaction:** The slot status update and booking insertion must be wrapped in a single database transaction (`BEGIN ... COMMIT`) to ensure atomicity. If insertion fails, slot status rollback is mandatory.
- **Booking Reference Generation & Collision Handling:**
  - Prefix format: `BK-` followed by exactly 6 characters.
  - Character set: Uppercase alphanumeric excluding visually ambiguous characters (`0`, `O`, `1`, `I`). Permitted alphabet: `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (base32).
  - Uniqueness: Enforced via database UNIQUE index on `bookings(booking_reference)`.
  - Collision Retry: In the rare event of a unique key collision (PostgreSQL error `23505`), regenerate a new reference and retry up to 5 times. If all 5 attempts fail, abort the transaction, log a critical alert, and return HTTP 500 `INTERNAL_SERVER_ERROR`.
- **Concurrency Invariant:**
  - Multiple concurrent requests targeting the same `slot_id` must be mutually exclusive. Exactly one request must succeed in transitioning the slot from `AVAILABLE` to `BOOKED`; competing requests must receive HTTP 409 `SLOT_UNAVAILABLE`.
- **Project Structure:** Follow standard NestJS/Express controller, service, repository layering.
- **Persistence:** All data must be saved to the primary PostgreSQL / SQLite database (no in-memory only mock).

---

## 7. Anti-Scope (What NOT to Build)
- No user authentication or session check (all callers are guest learners).
- No credit card processing or payment gateway integration.
- No outbound confirmation emails (SendGrid/SMTP) or SMS.
- No calendar invite `.ics` attachments.
- No provider push notifications.
- No booking cancellation endpoint (handled in TICK-06).
