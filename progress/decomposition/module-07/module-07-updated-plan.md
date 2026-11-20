# SkillSwap — Updated Execution Plan (Module 07 — Plan v3)

## Overview & Evolution
- **Plan v1:** Baseline 5-slice plan decomposed into `TICK-01` through `TICK-06`.
- **Plan v2:** Adapted for Meridian Corp company accounts and compressed 6-day investor demo timeline.
- **Plan v3 (Current):** Layered adaptation incorporating Meridian IT Director's **Role-Based Access Control (RBAC)** requirement using a **Scoped RBAC Shim**.

---

## 1. Preserved Tickets (Unchanged Work)
- **`TICK-01` (Database Migrations & Initial Seed Data):** Core entities (`providers`, `services`, `slots`) remain foundational.
- **`TICK-02` (Provider Profile Query API):** Endpoint `GET /api/v1/providers/:provider_id` remains unchanged.
- **`TICK-03` (Provider Slot Availability Query API):** Endpoint `GET /api/v1/providers/:provider_id/slots` remains unchanged, returning available slots in ISO-8601 UTC.

---

## 2. Modified Tickets (Surgically Patched for RBAC)
- **`TICK-04` (Booking Creation Transaction API):**
  - *Modification:* Add `employee_id` and `created_by_user_id` to bookings schema. Controller extracts `req.user` context and enforces authorization:
    - If `employee_id !== req.user.user_id`, assert `req.user.role === 'MANAGER'` AND target employee belongs to `req.user.organization_id`.
    - If unauthorized `EMPLOYEE` attempts delegation, reject with `HTTP 403 Forbidden` (`BOOKING_FORBIDDEN`).
    - Enforce atomic slot update (`status = 'BOOKED' WHERE id = slot_id AND status = 'AVAILABLE'`) and transaction commit.
- **`TICK-05` (Auth / Login Endpoint & JWT Claims):**
  - *Modification:* Login issues signed JWT containing `{ user_id, organization_id, department_id, role }`. Auth middleware verifies tokens and binds context to `req.user`.
- **Frontend Slot Picker & Booking Modal (`ProviderProfileView.tsx`):**
  - *Modification:* Modal dynamically presents delegation selector only if `req.user.role === 'MANAGER'`. Employees see their own name locked as recipient.

---

## 3. Cut & Deferred Scope (Explicit Phase 2 Backlog)
To guarantee delivery within the 6-day window without sacrificing security or backend integrity, the following features are explicitly deferred:

| Deferred Scope | Reason for Deferral | Scheduled Phase |
| :--- | :--- | :--- |
| **Organization Administration Screens** | Super-admin consoles to create companies or invite users are unnecessary for scripted investor demonstration. | Phase 2 (Enterprise MVP) |
| **Dynamic Role & Permission Management** | Roles are fixed enum values (`EMPLOYEE`, `MANAGER`, `DEPARTMENT_HEAD`); custom permission matrices deferred. | Phase 2 (Enterprise MVP) |
| **Configurable Department Hierarchy** | Departments are pre-seeded in the database; nested tree structures deferred. | Phase 2 (Enterprise MVP) |
| **Advanced Department Analytics Dashboards** | Department heads receive a filtered tabular list of bookings; visual graphs and CSV exports deferred. | Phase 2 (Enterprise MVP) |
| **Bulk Employee Provisioning & SCIM / SAML** | Corporate users are seeded via migration scripts; Active Directory / Okta sync deferred. | Phase 2 (Enterprise MVP) |
| **Consolidated Invoicing & Net-30 Billing** | Payment remains charged to booker's credit card; monthly corporate invoice reconciliation deferred. | Phase 2 (Enterprise MVP) |
| **Slice 3 Custom Provider Slot Editor UI** | Providers use pre-seeded slots; schedule drafting UI deferred. | Post-Demo Sprint 1 |
| **Slice 4 Redis Distributed Concurrency Hold** | DB-level atomic conditional update guarantees slot integrity without Redis. | Post-Demo Sprint 1 |
| **Slice 5 Live Stripe Multi-Party Payouts** | Simulated payment confirmation modal used for investor demo. | Post-Demo Sprint 1 |

---

## 4. Added Tickets (Scoped RBAC Shim)

### `TICK-07A`: RBAC Schema Migration & User Attribution
- **Scope:** Add `organization_id`, `department_id`, and `role` to `users`. Add `employee_id` and `created_by_user_id` to `bookings`. Add indexes on `(organization_id, department_id)` and foreign keys.
- **Estimate:** **Small (S)** — 3 hours.
- **Dependencies:** `TICK-01`.

### `TICK-07B`: Backend RBAC Guard & Delegation Authorization
- **Scope:** Implement `@Roles()` decorator and guard. Enforce:
  1. `EMPLOYEE` can book only for self (HTTP 403 on divergence).
  2. `MANAGER` can book only for employees in their own `organization_id`.
  3. `DEPARTMENT_HEAD` cannot book for others unless approved.
- **Estimate:** **Medium (M)** — 5 hours.
- **Dependencies:** `TICK-05`, `TICK-07A`.

### `TICK-07C`: Department-Scoped Booking Query API
- **Scope:** Implement `GET /api/v1/bookings` with row-level filtering based strictly on `req.user` context (employees see own; managers see initiated/own; department heads see department bookings). Untrusted query parameters rejected.
- **Estimate:** **Small (S)** — 3 hours.
- **Dependencies:** `TICK-07B`.

### `DEMO-02`: Meridian RBAC Seed Dataset & 3-Role Investor Runbook
- **Scope:** Seed Meridian Corp with HR and Engineering departments and 3 distinct user accounts (`meridian_emp`, `meridian_mgr`, `meridian_head`). Draft automated end-to-end verification script for investor demo.
- **Estimate:** **Small (S)** — 2 hours.
- **Dependencies:** `TICK-07C`.

---

## 5. Security & Verification Test Matrix (10 Invariant Gates)

1. **Employee Cross-Booking Rejection:** `EMPLOYEE` attempts to book for another user $\to$ HTTP 403 `BOOKING_FORBIDDEN`.
2. **Manager Intra-Org Booking:** `MANAGER` books for employee in own organization $\to$ HTTP 201 Created.
3. **Manager Cross-Org Booking Rejection:** `MANAGER` attempts to book for employee in external organization $\to$ HTTP 403 Forbidden.
4. **Department Head Scope Query:** `DEPARTMENT_HEAD` queries `GET /api/v1/bookings` $\to$ returns exactly all bookings for employees within their department.
5. **Cross-Department URL Injection:** `DEPARTMENT_HEAD` appends `?department_id=other` $\to$ parameter ignored; query remains locked to authenticated token context.
6. **Employee Peer Query Rejection:** `EMPLOYEE` attempts to view another employee's booking $\to$ HTTP 403 / 404 Not Found.
7. **Unauthenticated Access:** Request without valid Bearer token $\to$ HTTP 401 Unauthorized.
8. **Transactional Rollback on Conflict:** Slot collision during booking creation rolls back booking insertion atomically.
9. **Attribution Integrity:** `bookings.created_by_user_id` and `bookings.employee_id` are persisted accurately.
10. **Zero Regression:** Core anonymous/individual learner booking flows remain functional.

---

## 6. Revised 6-Day Critical Path Timeline

```
Day 1: Execute TICK-05 (Auth JWT Claims) + TICK-07A (RBAC Database Migrations)
Day 2: Implement TICK-07B (Backend RBAC Guards & Delegation Validation)
Day 3: Implement TICK-07C (Department-Scoped Booking Query API) + UI Role Visibility
Day 4: Run 10-Point Security & Authorization Integration Test Suite
Day 5: Execute DEMO-02 (Meridian Seed Data & 3-Role Dry Run Presentation)
Day 6: Final Stabilization, Polish & Executive Investor Demo Presentation
```
