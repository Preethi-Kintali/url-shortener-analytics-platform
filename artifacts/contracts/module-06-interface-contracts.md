# SkillSwap — Parallel Execution Interface Contracts (Module 06)

## 1. Overview & Purpose
This document establishes the frozen, canonical interface contracts for parallel execution across three independent development streams:
- **Stream 1 (Agent 1 / Backend 1):** Provider Availability & Slot Retrieval (`TICK-03`)
- **Stream 2 (Agent 2 / Backend 2):** Booking Creation & Slot Hold (`TICK-04`)
- **Stream 3 (Agent 3 / Frontend):** Provider Profile & Slot Selection View (`TICK-02` Client)

All streams operate in isolated feature branches and rely on this contract as the sole source of truth prior to synchronization checkpoints.

---

## 2. Shared Canonical Types & Enums

```typescript
// Shared Types (Mandatory for all streams)
export type UUID = string; // RFC 4122 UUID v4 regex: ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
export type ISODateTimeString = string; // ISO 8601 UTC format: YYYY-MM-DDTHH:mm:ss.sssZ

export enum SlotStatus {
  AVAILABLE = 'AVAILABLE',
  HELD = 'HELD',
  BOOKED = 'BOOKED'
}

export enum BookingStatus {
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED'
}
```

---

## 3. Contract A: Slot Availability API (Stream 1 Producer $\leftrightarrow$ Stream 2 & 3 Consumers)

### Endpoint Specification:
- **Route:** `GET /api/v1/providers/{provider_id}/slots`
- **Method:** `GET`
- **Headers:** `Accept: application/json`

### Path Parameters:
- `provider_id`: UUID (required, format: UUID v4)

### Success Response (HTTP 200 OK):
```json
{
  "provider_id": "22222222-2222-2222-2222-222222222222",
  "slots": [
    {
      "slot_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01",
      "provider_id": "22222222-2222-2222-2222-222222222222",
      "start_time": "2026-11-21T10:00:00.000Z",
      "end_time": "2026-11-21T11:00:00.000Z",
      "status": "AVAILABLE"
    }
  ]
}
```

### Error Responses:
- `400 Bad Request`: `{ "error": { "code": "INVALID_UUID", "message": "Malformed provider_id" } }`
- `404 Not Found`: `{ "error": { "code": "PROVIDER_NOT_FOUND", "message": "Provider does not exist" } }`

---

## 4. Contract B: Booking Creation API (Stream 2 Producer $\leftrightarrow$ Stream 3 Frontend Consumer)

### Endpoint Specification:
- **Route:** `POST /api/v1/bookings`
- **Method:** `POST`
- **Headers:**
  - `Content-Type: application/json`
  - `Idempotency-Key`: UUID (optional, for safe retries)

### Request Payload:
```json
{
  "provider_id": "22222222-2222-2222-2222-222222222222",
  "service_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "slot_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01",
  "learner_name": "Jordan Lee",
  "learner_email": "jordan.lee@example.com",
  "notes": "Coaching session on microservice contract design."
}
```

### Success Response (HTTP 201 Created):
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
  "created_at": "2026-11-20T18:15:00.000Z"
}
```

### Error Responses:
- `400 Bad Request`: `{ "error": { "code": "VALIDATION_ERROR", "message": "Validation failed", "details": [...] } }`
- `404 Not Found`: `{ "error": { "code": "ENTITY_NOT_FOUND", "message": "Slot or service not found" } }`
- `409 Conflict`: `{ "error": { "code": "SLOT_UNAVAILABLE", "message": "Slot already booked" } }`

---

## 5. Contract C: Internal Slot State Mutation Synchronization (Stream 1 $\leftrightarrow$ Stream 2)

When Stream 2 (Booking Creation) commits a booking, it must atomically mutate the slot state owned by Stream 1:
- **Contract Boundary:** Atomic Database Mutation on table `slots`.
- **Query Specification:**
  ```sql
  UPDATE slots 
  SET status = 'BOOKED' 
  WHERE id = :slot_id AND status = 'AVAILABLE';
  ```
- **Invariants:**
  - If rows affected == 1: Proceed with booking creation.
  - If rows affected == 0: Throw `SLOT_UNAVAILABLE` (HTTP 409).
