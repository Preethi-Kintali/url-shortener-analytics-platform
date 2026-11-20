# SkillSwap — Compound Requirement Break Analysis (Module 07 Step 5)

## 1. Incident Summary: The Mid-Sprint Compound Twist
Two minutes after delivering our adapted 6-day plan, Product Management injected a second requirement expansion from Meridian Corp's IT Director:
> *"Their IT director requires role-based access for company accounts: Managers can book for any employee; Employees can only view their own bookings; Department Heads need to see all bookings in their department."*

This changes the scope from a simple delegation boolean (`can_book_for_others`) into a multi-tiered **Role-Based Access Control (RBAC) and Department Scoping** domain.

---

## 2. Blast Radius Re-Evaluation & Escalations

### A. New Subsystems Affected (Previously Untouched):
1. **Booking Query / List API (`GET /api/v1/bookings`):**
   - *Previous status:* NO IMPACT.
   - *Escalated status:* **MAJOR.**
   - *Requirement:* Must enforce row-level security / data scoping:
     - `EMPLOYEE`: `WHERE learner_id = req.user.id OR booked_for_email = req.user.email`
     - `MANAGER`: Can book for anyone; views their initiated bookings and own bookings.
     - `DEPARTMENT_HEAD`: `WHERE department_name = req.user.department_name`
2. **Audit Logging & Security Attribution:**
   - *Previous status:* NO IMPACT.
   - *Escalated status:* **MINOR.**
   - *Requirement:* Audit events must record both `created_by_user_id` and `booked_for_email`, with user agent and IP, ensuring accountability for delegated spend.

### B. Artifact Escalations (MINOR $\to$ MAJOR):
1. **User Data Model:**
   - *Escalated from MINOR to MAJOR:* A boolean flag (`can_book_for_others`) is no longer sufficient. Users must store:
     - `role`: Enum (`'EMPLOYEE'`, `'MANAGER'`, `'DEPARTMENT_HEAD'`)
     - `department_name`: String nullable (`'Engineering'`, `'Sales'`, etc.)
2. **Auth / JWT Token Payload & Session Guard:**
   - *Escalated from MINOR to MAJOR:* Signed token must carry `{ id, email, role, department_name, company_name }`. Auth guard middleware extracts and validates these claims for every request.
3. **Backend Authorization Enforcement:**
   - *Escalated to CRITICAL:* Authorization cannot be client-side cosmetic button hiding. The booking creation endpoint must reject delegation attempts by users with `role === 'EMPLOYEE'` with `HTTP 403 Forbidden`.

---

## 3. Decision Assessment: Minimal Bridge vs. Full Architecture Pivot

### The Dilemma:
Does the arrival of 3 roles and departments invalidate our Step 2 decision (**Option B: Minimal Bridge**) and force a pivot to **Option A (Proper Organization Architecture)**?

### The Architectural Verdict:
**Option B (Minimal Bridge) Remains Valid — Extended to a "Scoped RBAC Shim"**.
- A full relational enterprise model (`organizations`, `departments`, `roles`, `permissions`, `role_permissions`, `user_departments`) requires 2–3 weeks of database migrations, admin consoles, and directory sync. Pivoting to full architecture today guarantees **100% failure of the 6-day Investor Demo**.
- **The Pragmatic Scoped-RBAC Shim:**
  1. Add `role VARCHAR(20) DEFAULT 'EMPLOYEE'` and `department_name VARCHAR(100)` to `users`.
  2. Add `department_name VARCHAR(100)` to `bookings` (copied from recipient at booking time for efficient indexed filtering).
  3. Enforce backend role gates in controllers (`@Roles('MANAGER')`, `@Roles('DEPARTMENT_HEAD')`).
- This satisfies 100% of Meridian Corp's functional criteria for the demo, takes **1.5 additional engineering days**, and preserves the Day 6 investor demo deadline. Full multi-tenant RBAC remains scheduled for the funded post-demo architecture refactor.

---

## 4. Further Backlog Cuts to Protect the 6-Day Deadline
To absorb the 1.5 days required for the Scoped RBAC Shim, the following secondary features are removed from the 6-day scope:

| Feature Cut | Why It Is Safe to Cut |
| :--- | :--- |
| **Department Management Admin UI** | Departments and roles for Meridian Corp are seeded via migration `005`. Demo uses pre-configured Meridian profiles (`meridian_mgr`, `meridian_emp`, `meridian_head`). |
| **Department Aggregate Analytics / Charts** | Department heads see a filtered tabular list of department bookings; visual graphs and CSV exports deferred to Post-Demo Sprint 2. |
| **Outbound Email Fallback** | All transactional notifications strictly use high-fidelity in-app modal confirmations. Zero hours spent debugging external SMTP. |
