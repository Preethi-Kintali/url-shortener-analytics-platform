# SkillSwap — Mid-Build Adaptation Note to Product Management (Module 07 — Memo v2)

**To:** Product Management  
**From:** Engineering Lead  
**Date:** November 20, 2026  
**Subject:** Revised Engineering Plan (v3): Bounded RBAC Integration & 6-Day Investor Demo Commitment  

---

### Executive Impact Statement (Revised Memo v2)

> In my earlier message, we committed to individual bookings and basic corporate delegation; with the Meridian IT Director’s new role-based access requirement, we have successfully layered a **Scoped RBAC Shim** into the 6-day plan to demonstrate distinct permissions for **Employees**, **Managers**, and **Department Heads**. Under this revised scope, the Day 6 investor demo will show managers booking on behalf of intra-company employees, employees restricted to self-booking, and department heads viewing their department's scheduled sessions with strict backend authorization enforcement. To absorb this 1.5-day addition without risking the demo deadline, we have made hard trade-offs: dynamic admin consoles, configurable department trees, and visual analytics dashboards are formally deferred to our post-funding Phase 2 enterprise sprint. The critical dependency remains seed data alignment: we are pre-seeding Meridian Corp accounts in migration `005` so the demo script runs deterministically without building custom administrative setup screens. We need your sign-off today that a 3-role demonstration with seeded corporate structures satisfies Meridian's initial pilot signoff criteria for the investor presentation.

---

### Comparison of Plan Evolution for Product Leadership

| Capability | Baseline Plan (v1) | Adapted Plan (v2) | Final Layered Plan (v3) | Delivery Target |
| :--- | :--- | :--- | :--- | :--- |
| **Learner Booking** | Anonymous / Self | Individual Authenticated | Individual Authenticated | **Day 6 (Demo)** |
| **Corporate Delegation** | Out of Scope | Single boolean flag (`can_book`) | Strict Backend RBAC (`MANAGER` only) | **Day 6 (Demo)** |
| **Department Scoping** | Out of Scope | Out of Scope | `DEPARTMENT_HEAD` SQL join filter | **Day 6 (Demo)** |
| **Org Admin & SCIM** | Backlog | Backlog | **Explicit Phase 2 Enterprise MVP** | **Post-Funding** |
| **Consolidated Invoicing**| Backlog | Backlog | **Explicit Phase 2 Enterprise MVP** | **Post-Funding** |
| **Payment Rails** | Live Stripe multi-party | Simulated confirmation | Simulated confirmation | **Post-Demo Sprint 1** |

---

### Hard Boundary: Controlled Demo vs. Phase 2 Production Platform

We must be completely transparent with stakeholders:
1. **What Ships on Day 6:** A secure, backend-enforced, 3-role demonstration with transactional booking attribution and strict row-level security.
2. **What Ships in Phase 2:** Full multi-tenant relational architecture (`organizations`, `departments`, `permissions`), SAML/SCIM Okta integration, organization-level net-30 invoicing, and self-service organizational administration.
