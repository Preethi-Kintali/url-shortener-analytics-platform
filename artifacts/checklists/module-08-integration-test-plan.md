# SkillSwap — Master Integration Test Plan (Module 08)

## 1. Overview & CI Integration Architecture
This document defines the standing automated cross-component integration test suite designed to run in continuous integration (CI) on every branch merge and deployment checkpoint. 

Its primary objective is to detect boundary seam divergence, format mismatches, and race conditions before code reaches staging or production.

---

## 2. Cross-Component Integration Test Suite

### Test 1: `TEST-INT-01`: End-to-End Individual Booking & Slot State Propagation
- **Objective:** Verifies that an individual learner booking atomically mutates slot availability across independent services.
- **Components Involved:**
  - `ProviderSlotController` (`api/src/slots/`)
  - `BookingCreationController` (`api/src/bookings/`)
  - `DatabaseLayer` (PostgreSQL `slots` and `bookings` tables)
  - `FrontendSlotPicker` (`ProviderProfileView.tsx`)
- **Setup Preconditions:**
  - Database seeded with Marcus Vance (`provider_id: 22222222-2222-2222-2222-222222222222`).
  - Slot `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01` exists with `status = 'AVAILABLE'`.
  - Authenticated learner session active (`learner_id: 11111111-1111-1111-1111-111111111111`).
- **Execution Steps:**
  1. Call `GET /api/v1/providers/22222222-2222-2222-2222-222222222222/slots`.
  2. Assert slot `bbbbbbbb-...-01` is present in response array with `status: "AVAILABLE"`.
  3. Send `POST /api/v1/bookings` with payload:
     `{ "provider_id": "2222...", "service_id": "aaaa...", "slot_id": "bbbb...01", "learner_name": "Jordan Lee", "learner_email": "jordan@example.com" }`.
  4. Assert response is HTTP 201 Created with valid `booking_reference` matching regex `^BK-[0-9A-Z]{6}$`.
  5. Call `GET /api/v1/providers/22222222-2222-2222-2222-222222222222/slots` again.
- **Expected Results:**
  - Step 3 returns HTTP 201 with `slot_status: "BOOKED"` and `status: "CONFIRMED"`.
  - Step 5 returns slot array omitting slot `bbbbbbbb-...-01` (or returning it with status `'BOOKED'`).
- **Contract Points Validated:** Contract A (Availability Response Schema) and Contract B (Booking Request & Response Schema).

---

### Test 2: `TEST-INT-02`: High-Concurrency Slot Mutex & Collision Resolution
- **Objective:** Verifies that concurrent booking attempts on the identical slot result in exactly one successful booking and clean HTTP 409 rejection for competing callers.
- **Components Involved:**
  - `BookingCreationService`
  - PostgreSQL Row-Level Locking / Conditional Update Engine
- **Setup Preconditions:**
  - Slot `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02` exists with `status = 'AVAILABLE'`.
  - Two distinct authenticated learners (Learner A and Learner B).
- **Execution Steps:**
  1. Dispatch two asynchronous `POST /api/v1/bookings` requests in parallel for slot `bbbbbbbb-...-02` within a 5ms window.
  2. Collect both HTTP response codes and payloads.
- **Expected Results:**
  - Exactly one request returns `HTTP 201 Created` with a new booking ID.
  - The second request returns `HTTP 409 Conflict` with JSON error envelope `{ "code": "SLOT_UNAVAILABLE", "message": "The requested slot is no longer available." }`.
  - `SELECT COUNT(*) FROM bookings WHERE slot_id = 'bbbbbbbb-...-02'` returns exactly `1`.
- **Contract Points Validated:** Contract C (Concurrency Mutex Invariant) and Standard API Error Specification.

---

### Test 3: `TEST-INT-03`: Scoped RBAC Manager Delegation & Employee Rejection
- **Objective:** Asserts that managers can book on behalf of company colleagues, while employees are strictly forbidden from delegating.
- **Components Involved:**
  - `AuthGuard` (`@Roles()`)
  - `BookingCreationController`
  - `users` and `bookings` tables
- **Setup Preconditions:**
  - Meridian Corp seeded: Manager Jordan (`role: 'MANAGER'`), Employee Sarah (`role: 'EMPLOYEE'`), both `organization_id: org_meridian`.
  - External user Alex (`organization_id: org_external`).
- **Execution Steps:**
  1. **Employee Delegation Attempt:** Sarah attempts `POST /api/v1/bookings` with `employee_id = jordan_id`.
  2. **Manager Valid Delegation:** Jordan attempts `POST /api/v1/bookings` with `employee_id = sarah_id`.
  3. **Manager Cross-Org Attempt:** Jordan attempts `POST /api/v1/bookings` with `employee_id = alex_id`.
- **Expected Results:**
  - Step 1 returns `HTTP 403 Forbidden` (`BOOKING_FORBIDDEN: Employees can only book sessions for themselves`). Zero database rows created.
  - Step 2 returns `HTTP 201 Created`. Booking record created with `created_by_user_id = jordan_id` and `employee_id = sarah_id`.
  - Step 3 returns `HTTP 403 Forbidden` (`Target employee does not belong to your organization`).
- **Contract Points Validated:** Scoped RBAC Authorization Invariants and Anti-IDOR Tenant Security.

---

### Test 4: `TEST-INT-04`: Department Head Row-Level Query Scoping & Tamper Resistance
- **Objective:** Verifies that department heads receive only bookings belonging to their department, and that URL query parameter tampering is defeated.
- **Components Involved:**
  - `BookingQueryController` (`GET /api/v1/bookings`)
  - PostgreSQL Row-Level Filter Query Engine
- **Setup Preconditions:**
  - Meridian Corp Engineering Department has 3 active bookings.
  - Meridian Corp HR Department has 2 active bookings.
  - Authenticated session for Carlos (`role: 'DEPARTMENT_HEAD'`, `department_id: dept_engineering`).
- **Execution Steps:**
  1. Call `GET /api/v1/bookings` with Bearer token for Carlos.
  2. Call `GET /api/v1/bookings?department_id=dept_hr` with Bearer token for Carlos.
- **Expected Results:**
  - Step 1 returns array of exactly 3 bookings (all belonging to engineering employees).
  - Step 2 ignores the injected query parameter and returns the identical 3 engineering bookings. Zero HR records leaked.
- **Contract Points Validated:** Server-Side JWT Claims Binding & Row-Level Security Scoping.

---

### Test 5: `TEST-INT-05`: State Machine Lifecycle & Cancellation Refund Reversal
- **Objective:** Verifies bidirectional state machine transitions across booking and availability domains.
- **Components Involved:**
  - `BookingCancellationController`
  - `SlotManagementService`
- **Setup Preconditions:**
  - Confirmed booking exists for slot `bbbbbbbb-...-01` (`slot.status = 'BOOKED'`, `booking.status = 'CONFIRMED'`).
- **Execution Steps:**
  1. Call `POST /api/v1/bookings/:id/cancel`.
  2. Query database state for booking and slot.
  3. Query public availability endpoint `GET /api/v1/providers/:id/slots`.
- **Expected Results:**
  - Step 1 returns `HTTP 200 OK` with `{ "status": "CANCELLED" }`.
  - Step 2 proves `booking.status === 'CANCELLED'` and `slot.status === 'AVAILABLE'`.
  - Step 3 returns slot `01` in the public available slot list.
- **Contract Points Validated:** Dual-State Machine Decoupling & Propagation Invariant.
