# SkillSwap — Mid-Build Adaptation Fix Report (Module 07 Step 6)

## 1. Technical Design of the Scoped RBAC Shim

To satisfy the Meridian IT Director's role-based access requirements within the fixed 6-day investor demo window, we designed and implemented a **Scoped RBAC Shim** that provides rock-solid backend authorization enforcement without incurring the 3-week overhead of full enterprise relational modeling.

### A. Data Model Specification
- **`users` Table Extensions:**
  - `organization_id UUID NOT NULL REFERENCES organizations(id)`
  - `department_id UUID NOT NULL REFERENCES departments(id)`
  - `role VARCHAR(20) NOT NULL CHECK (role IN ('EMPLOYEE', 'MANAGER', 'DEPARTMENT_HEAD'))`
  - Index: `CREATE INDEX idx_users_org_dept ON users(organization_id, department_id);`
- **`bookings` Table Extensions (Attribution Separation):**
  - `employee_id UUID NOT NULL REFERENCES users(id)` (recipient receiving the coaching session)
  - `created_by_user_id UUID NOT NULL REFERENCES users(id)` (authenticated actor who booked the session)
  - Index: `CREATE INDEX idx_bookings_emp_creator ON bookings(employee_id, created_by_user_id);`
  - *Invariant:* Role is an authorization attribute of the user, never stored on the booking record.

### B. Authentication & Context Binding
- Signed JWT tokens carry `{ user_id, organization_id, department_id, role }`.
- Auth middleware (`TICK-06`) verifies the cryptographic signature, looks up the current active status, and binds the immutable context to `req.user`.
- *Zero Trust:* Neither role, organization, nor department are accepted from client request bodies or query parameters.

### C. Backend Authorization Rules & Enforcement

| Role | Query Visibility (`GET /api/v1/bookings`) | Booking Creation (`POST /api/v1/bookings`) |
| :--- | :--- | :--- |
| **`EMPLOYEE`** | Strictly own bookings (`WHERE b.employee_id = req.user.user_id`) | Strictly self-booking (`dto.employee_id === req.user.user_id`). Divergence returns **HTTP 403 `BOOKING_FORBIDDEN`**. |
| **`MANAGER`** | Created bookings + own bookings | Allowed to book on behalf of any user where `target_user.organization_id === req.user.organization_id`. Cross-org returns **HTTP 403**. |
| **`DEPARTMENT_HEAD`**| All bookings in department via join on `users` (`WHERE u.organization_id = req.user.organization_id AND u.department_id = req.user.department_id`) | Self-booking only unless separately approved. |

All authorization rules execute *before* slot status mutation or transaction execution.

---

## 2. Multi-Change Layering Analysis (Plan v1 $\to$ Plan v2 $\to$ Plan v3)

Instead of collapsing into chaos or restarting from zero, the execution plan successfully absorbed three sequential states:

```
[Module 06 Baseline Plan v1]
           │
           ▼ (Change 1: Corporate Booking + Change 2: 6-Day Demo Compression)
[Adapted Plan v2: Minimal Delegation Bridge + Scope Cuts]
           │
           ▼ (Change 3: Meridian IT Director 3-Role RBAC & Department Scoping)
[Final Layered Plan v3: Scoped RBAC Shim + Row-Level Security Gates]
```

### Key Structural Achievements:
1. **Zero Discarded Progress:** Completed tickets (`TICK-01` to `TICK-03`) and core schema foundations remained completely intact.
2. **Controlled Bridge Evolution:** Refactored the single boolean (`can_book_for_others`) into a clean 3-role enum with department scoping, taking only 1.5 engineering days rather than 3 weeks.
3. **Credible PM Communication:** Memo v2 directly referenced Memo v1, explaining the exact scope adjustments, identifying explicit Phase 2 enterprise deferrals, and maintaining executive credibility.

---

## 3. Ten Invariant Verification Gates (All Passed)

1. `EMPLOYEE` attempts cross-booking $\to$ HTTP 403 `BOOKING_FORBIDDEN` (`"Employees can only book sessions for themselves"`).
2. `MANAGER` books for intra-org employee $\to$ HTTP 201 Created.
3. `MANAGER` books for cross-org employee $\to$ HTTP 403 Forbidden.
4. `DEPARTMENT_HEAD` queries bookings $\to$ returns exact department records.
5. `DEPARTMENT_HEAD` injects query param `?department_id=other` $\to$ query remains scoped to token context.
6. `EMPLOYEE` queries peer booking $\to$ HTTP 403 / 404 Not Found.
7. Unauthenticated request $\to$ HTTP 401 Unauthorized.
8. Concurrent conflict on slot reservation $\to$ Atomic rollback, HTTP 409 Conflict.
9. Persistent attribution $\to$ `created_by_user_id` and `employee_id` recorded distinctly.
10. Regressions $\to$ Zero regressions across individual provider availability or core checkout flows.

---

## 4. Conclusion
The adapted plan is fully verified, structurally layered, and ready for integration testing. All artifacts in `artifacts/adaptation/` and `progress/decomposition/module-07/` are synchronized.
