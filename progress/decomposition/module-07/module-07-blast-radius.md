# SkillSwap — Mid-Build Blast Radius Analysis (Module 07 — Plan v3)

## Executive Summary
This document provides the cumulative blast radius analysis across three successive requirement evolutions:
1. **Change 1 (Initial Injection):** Meridian Corp requires corporate accounts capable of booking on behalf of employees.
2. **Change 2 (Timeline Constraint):** Executive leadership scheduled an all-hands **Investor Demo in 6 days**.
3. **Change 3 (Compound Twist):** Meridian IT Director mandates **Role-Based Access Control (RBAC)**:
   - `EMPLOYEE`: Can view only their own bookings; can book sessions only for themselves.
   - `MANAGER`: Can book on behalf of any employee within their organization; views only their created/own bookings.
   - `DEPARTMENT_HEAD`: Views all bookings within their department; no delegation rights.

Strategy: **Scoped RBAC Shim** (pragmatic relational bridge adhering to strict backend authorization invariants while deferring multi-tenant SAML/SCIM directories to post-funding Phase 2).

---

## 1. Cumulative Blast Radius Matrix (Plan v3)

| Subsystem / Artifact | Baseline Status | Impact Level | Plan v3 Technical Blast Radius & Behavioral Invariants |
| :--- | :--- | :--- | :--- |
| **User Data Model** | IN PROGRESS | **MAJOR** | Schema migration `003_add_rbac_to_users.sql` adds `organization_id UUID NOT NULL`, `department_id UUID NOT NULL`, and `role VARCHAR(20) NOT NULL CHECK (role IN ('EMPLOYEE', 'MANAGER', 'DEPARTMENT_HEAD'))` to `users`. Indexed on `(organization_id, department_id)`. |
| **Bookings Data Model** | COMPLETED | **MAJOR** | Schema migration `004_add_delegation_attribution_to_bookings.sql` adds `employee_id UUID NOT NULL REFERENCES users(id)` and `created_by_user_id UUID NOT NULL REFERENCES users(id)`. Separation of attribution: `created_by_user_id` tracks billing/creator; `employee_id` tracks recipient. |
| **Auth & Session Context** | IN PROGRESS | **MAJOR** | JWT claims payload expanded to include `{ user_id, organization_id, department_id, role }`. Auth middleware verifies signed tokens and binds immutable context to `req.user`. Token values are server-validated; zero trust of frontend parameters. |
| **Booking Creation API (`POST /api/v1/bookings`)** | COMPLETED | **CRITICAL** | Authorization guard executes *before* slot reservation or transaction start: <br>• If `dto.employee_id !== req.user.user_id`: require `req.user.role === 'MANAGER'` AND verify `target_user.organization_id === req.user.organization_id`. <br>• If an `EMPLOYEE` submits `employee_id !== req.user.user_id`: abort with `HTTP 403 Forbidden` (`code: 'BOOKING_FORBIDDEN'`). |
| **Booking Query / List API (`GET /api/v1/bookings`)** | NOT STARTED | **MAJOR** | Database queries apply row-level security filters derived exclusively from `req.user`: <br>• `EMPLOYEE`: `WHERE b.employee_id = req.user.user_id` <br>• `MANAGER`: `WHERE b.created_by_user_id = req.user.user_id OR b.employee_id = req.user.user_id` <br>• `DEPARTMENT_HEAD`: `JOIN users u ON u.id = b.employee_id WHERE u.organization_id = req.user.organization_id AND u.department_id = req.user.department_id`. Untrusted query params rejected. |
| **Booking UI Component (`ProviderProfileView.tsx`)** | COMPLETED | **MAJOR** | UI inspects `req.user.role`: <br>• If `MANAGER`: renders employee search/picker dropdown. <br>• If `EMPLOYEE`: employee selection is hidden/locked to self. <br>• If `DEPARTMENT_HEAD`: read-only department roster view. |
| **Search & Listing** | COMPLETED | **NO IMPACT** | Provider search, service listings, and slot queries remain orthogonal to enterprise tenant authorization. |
| **Payment & Billing** | NOT STARTED | **NO IMPACT** | Billing remains bound to `created_by_user_id` payment method. Corporate invoice consolidation deferred to Phase 2. |
| **Interface Contracts** | FROZEN | **MINOR** | Contract B updated with backward-compatible fields: `employee_id?: string` in request payload. Zero breaking modifications to existing slot availability or provider contracts. |

---

## 2. Risk & Confidence Assessment
- **Confidence Level:** **90%** for 6-day demo delivery. The Scoped RBAC Shim avoids building administrative screens or dynamic permission matrices, focusing 100% of engineering bandwidth on backend authorization enforcement and data consistency.
- **Identified Residual Risks:**
  - *Seed Data Drift:* Staging demo requires pre-seeded Meridian employees across HR and Engineering departments.
  - *Mitigation:* Migration `005_seed_meridian_rbac_demo.sql` provides deterministic UUIDs for automated smoke testing.
