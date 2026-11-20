# TICK-06: GET /api/v1/learners/me/bookings & Cancel Booking

## 1. Title
`TICK-06: GET /api/v1/learners/me/bookings & POST /api/v1/bookings/:id/cancel — Booking Lifecycle Management`

---

## 2. Context (Why)
In Slice 2, learners need visibility into their active sessions. Once authenticated, a learner can view all bookings associated with their account and cancel an upcoming session if needed, freeing up the provider's slot for other learners.

---

## 3. Scope (What)
- Schema migration updating `bookings` table to add nullable `learner_id UUID REFERENCES users(id)` foreign key.
- Update `POST /api/v1/bookings` (from TICK-04) to optionally bind the authenticated user's `id` from JWT session context to `bookings.learner_id`.
- Implement `GET /api/v1/learners/me/bookings`:
  - Enforce authentication via JWT middleware.
  - Return all bookings belonging to the requesting learner, joined with provider name, service title, and slot time.
- Implement `POST /api/v1/bookings/:id/cancel`:
  - Enforce authentication; verify that the booking belongs to the requesting learner (prevent IDOR).
  - Verify that the booking is in `CONFIRMED` status (cannot cancel already cancelled bookings).
  - Transition `bookings.status` to `'CANCELLED'`.
  - Transition the associated `slots.status` from `'BOOKED'` back to `'AVAILABLE'` so it can be re-booked.
  - Return updated booking payload.

---

## 4. Interface Contract (Inputs/Outputs/Data Shapes)

### Route 1: Get My Bookings
- **Method:** `GET`
- **Route:** `/api/v1/learners/me/bookings`
- **Headers:** `Authorization: Bearer <jwt_token>`
- **Response (200 OK):**
```json
{
  "bookings": [
    {
      "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
      "booking_reference": "BK-8F29A1",
      "status": "CONFIRMED",
      "provider": {
        "id": "22222222-2222-2222-2222-222222222222",
        "name": "Marcus Vance",
        "avatar_url": "https://assets.skillswap.dev/avatars/marcus.jpg"
      },
      "service": {
        "title": "1-on-1 System Architecture Coaching",
        "duration_minutes": 60,
        "price_cents": 6500
      },
      "slot": {
        "start_time": "2026-11-21T10:00:00.000Z",
        "end_time": "2026-11-21T11:00:00.000Z"
      },
      "created_at": "2026-11-20T17:50:00.000Z"
    }
  ]
}
```

### Route 2: Cancel Booking
- **Method:** `POST`
- **Route:** `/api/v1/bookings/:id/cancel`
- **Headers:** `Authorization: Bearer <jwt_token>`
- **Response (200 OK):**
```json
{
  "booking_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
  "booking_reference": "BK-8F29A1",
  "status": "CANCELLED",
  "slot_status": "AVAILABLE",
  "cancelled_at": "2026-11-20T18:05:00.000Z"
}
```

### Error Responses:
- **401 Unauthorized:** Missing or expired JWT token.
- **403 Forbidden:** Learner attempts to cancel a booking owned by another learner:
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You are not authorized to cancel this booking."
  }
}
```
- **404 Not Found:** Booking ID not found.
- **409 Conflict:** Booking is already cancelled:
```json
{
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "message": "Booking is already cancelled."
  }
}
```

---

## 5. Acceptance Criteria (Given / When / Then)

### Scenario 1: Retrieve Authenticated Learner Bookings
- **Given** Learner Sarah is authenticated and has 2 confirmed bookings in the database,
- **When** Sarah sends `GET /api/v1/learners/me/bookings` with valid JWT header,
- **Then** the server responds with HTTP status `200 OK`,
- **And** the `bookings` array contains exactly 2 bookings with status `CONFIRMED`.

### Scenario 2: Successful Booking Cancellation
- **Given** Learner Sarah owns a booking `#BK-8F29A1` in `CONFIRMED` status on slot `#SLOT-01`,
- **When** Sarah sends `POST /api/v1/bookings/<booking_id>/cancel` with valid JWT header,
- **Then** the server responds with HTTP status `200 OK`,
- **And** the booking record status updates to `'CANCELLED'`,
- **And** the corresponding slot `#SLOT-01` status updates to `'AVAILABLE'`.

### Scenario 3: Authorization Guard (Anti-IDOR)
- **Given** Learner Sarah owns booking `#BK-8F29A1`,
- **When** Learner Bob (authenticated with a different JWT) sends `POST /api/v1/bookings/<sarah_booking_id>/cancel`,
- **Then** the server responds with HTTP status `403 Forbidden`,
- **And** the booking remains `CONFIRMED` and slot remains `BOOKED`.

### Scenario 4: Preventing Duplicate Cancellation
- **Given** a booking has already been transitioned to `CANCELLED`,
- **When** the owner attempts to cancel it again,
- **Then** the server responds with HTTP status `409 Conflict`,
- **And** the error code is `"INVALID_STATE_TRANSITION"`.

---

## 6. Constraints (Rules to Follow)
- Database transaction: updating `bookings.status` to `CANCELLED` and `slots.status` to `AVAILABLE` must occur atomically.
- All routes must use the standard project JWT authentication guard/middleware.

---

## 7. Anti-Scope (What NOT to Build)
- No refund money calculations or Stripe API refund calls (mock/zero-dollar in Slice 2; refund ledgers deferred to Slice 5).
- No cancellation reason survey or dispute questionnaire.
- No cancellation penalty or late-cancellation fee deductions.
- No email notification dispatch to provider.
