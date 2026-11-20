# TICK-03: GET /api/v1/providers/:provider_id/slots — Retrieve Available Slots

## 1. Title
`TICK-03: GET /api/v1/providers/:provider_id/slots — Retrieve Available Slots for Provider`

---

## 2. Context (Why)
When a learner selects a mentor on the SkillSwap homepage, the frontend navigates to the mentor's profile page. To book a coaching session, the learner must view the mentor's bookable time windows. This endpoint retrieves all slots for a given provider that currently have `status = 'AVAILABLE'`.

---

## 3. Scope (What)
- Implement a single HTTP `GET` endpoint at `/api/v1/providers/:provider_id/slots`.
- Validate that `:provider_id` is a valid UUID; return 400 Bad Request if malformed.
- Verify that the provider exists in the `providers` table; return 404 Not Found if missing.
- Query the `slots` table for records where `provider_id = :provider_id` AND `status = 'AVAILABLE'`, ordered by `start_time ASC`.
- Return a JSON array of available slot objects with ISO-8601 timestamps.

---

## 4. Interface Contract (Inputs/Outputs/Data Shapes)

### HTTP Request:
- **Method:** `GET`
- **Route:** `/api/v1/providers/:provider_id/slots`
- **Path Parameter:**
  - `provider_id` (UUID string, required)

### HTTP Response (200 OK):
```json
{
  "provider_id": "22222222-2222-2222-2222-222222222222",
  "slots": [
    {
      "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01",
      "start_time": "2026-11-21T10:00:00.000Z",
      "end_time": "2026-11-21T11:00:00.000Z",
      "status": "AVAILABLE"
    },
    {
      "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02",
      "start_time": "2026-11-21T14:00:00.000Z",
      "end_time": "2026-11-21T15:00:00.000Z",
      "status": "AVAILABLE"
    }
  ]
}
```

### HTTP Response (400 Bad Request):
```json
{
  "error": {
    "code": "INVALID_UUID",
    "message": "The provided provider_id parameter is not a valid UUID format."
  }
}
```

### HTTP Response (404 Not Found):
```json
{
  "error": {
    "code": "PROVIDER_NOT_FOUND",
    "message": "No provider found with the specified provider_id."
  }
}
```

---

## 5. Acceptance Criteria (Given / When / Then)

### Scenario 1: Retrieve Available Slots for Valid Provider
- **Given** Provider Marcus (`22222222-2222-2222-2222-222222222222`) has 3 slots in `AVAILABLE` status,
- **When** a client sends `GET /api/v1/providers/22222222-2222-2222-2222-222222222222/slots`,
- **Then** the server responds with HTTP status `200 OK`,
- **And** the `slots` array contains exactly 3 items,
- **And** all items have `status: "AVAILABLE"`, sorted chronologically by `start_time`.

### Scenario 2: Excluding Non-Available Slots
- **Given** a slot for Provider Marcus has been updated to `status = 'BOOKED'`,
- **When** a client sends `GET /api/v1/providers/22222222-2222-2222-2222-222222222222/slots`,
- **Then** the booked slot is excluded from the returned `slots` array.

### Scenario 3: Non-Existent Provider
- **Given** no provider exists with ID `99999999-9999-9999-9999-999999999999`,
- **When** a client sends `GET /api/v1/providers/99999999-9999-9999-9999-999999999999/slots`,
- **Then** the server responds with HTTP status `404 Not Found`,
- **And** the error payload code is `"PROVIDER_NOT_FOUND"`.

### Scenario 4: Malformed Provider UUID
- **When** a client sends `GET /api/v1/providers/not-a-uuid/slots`,
- **Then** the server responds with HTTP status `400 Bad Request`,
- **And** the error payload code is `"INVALID_UUID"`.

---

## 6. Constraints (Rules to Follow)
- Public endpoint; zero authentication required.
- Timestamps must be returned in strict ISO-8601 UTC format with millisecond precision.
- Use indexed lookup on `slots(provider_id, status)`.

---

## 7. Anti-Scope (What NOT to Build)
- No dynamic generation of recurring slot patterns.
- No timezone parameter translation (e.g. `?tz=America/New_York` — client handles local display).
- No temporary reservation / hold countdowns (deferred to Slice 4).
- No slot buffer calculations (e.g., 15-minute transition gaps).
