# SkillSwap — Mid-Build Adaptation Reflection (Module 07 Step 7)

## 1. Comprehension Questions

### 1. Core Problem Solved
Mid-build adaptation solves the reality that software requirements are never static. In production engineering, requirements change due to emergent enterprise client needs, market shifts, and compressed deadlines. This module provides a disciplined, structural methodology—the **GPS Navigation Recalculation Model**—to assess blast radius, trace dependency impact lines, adjust scope, and layer changes without panicking, discarding completed progress, or slipping into uncommunicated crunch.

### 2. Highest-Impact Decision
The single highest-impact decision was selecting **Option B (Minimal Bridge / Scoped RBAC Shim)** and **Option A (Preserve and Patch)**. 
- *Why:* A purist approach (Option A: full multi-tenant Organization schema redesign) would have consumed 2–3 weeks, guaranteeing failure of the 6-day investor demo.
- *The Result:* The Scoped RBAC Shim bounded the implementation to 1.5 engineering days, adding `role` (`EMPLOYEE`, `MANAGER`, `DEPARTMENT_HEAD`) and `department_id` to `users`, and `employee_id` and `created_by_user_id` to `bookings`. Preserving existing verified tickets (`TICK-01` through `TICK-03`) avoided throwaway rework and protected the core booking conversion flow.

### 3. End-to-End Proof
The cumulative artifacts—`module-07-blast-radius.md`, `module-07-updated-plan.md` (Plan v3), `module-07-adaptation-note.md` (Memo v2), and `fix-proof.json`—prove end-to-end planning consistency:
- Complete traceability across user and booking entity migrations.
- Strict backend authorization invariants (HTTP 403 on unauthorized employee delegation, intra-org manager validation, and SQL join scoping for department heads).
- However, as senior engineers, we distinguish planning consistency from runtime proof: the 10-point authorization test suite, integration tests, and live demo staging runbook (`DEMO-02`) remain essential before declaring production readiness.

### 4. Risk & Mitigation
- **Primary Residual Risk:** Cross-organization delegation or department-level data leakage due to client parameter tampering or IDOR vulnerabilities.
- **Concrete Mitigation:** Strict backend authorization enforcement. Authorization checks execute *before* slot status mutation or transaction execution. Scoping filters in `GET /api/v1/bookings` derive exclusively from cryptographically verified server-side session context (`req.user`), completely ignoring client-supplied query parameters or body payloads.

---

## 2. Personal Reflection

### 5. Blast Radius & Multi-Change Layering
When the second requirement change arrived (the Meridian IT Director's 3-role mandate), rather than restarting from zero, I treated the plan as a living document:
1. Mapped the new requirements directly against existing dependency lines: user data model, JWT claims payload, booking creation guard, and booking query filtering.
2. Escalated affected artifacts from MINOR to MAJOR with precise technical justification.
3. Evolved the single boolean flag into the Scoped RBAC Shim.
4. Drew a hard, non-negotiable boundary: what ships in 6 days (backend-enforced demo shim) vs. what is explicitly deferred to Phase 2 (full enterprise SAML, dynamic roles, org invoicing, and admin consoles).

### 6. The "Work Harder" Trap
The instinct to "just work harder" or absorb new scope through heroic crunch is a dangerous fantasy:
- It does not reduce the volume of work; it only increases fatigue, mental blind spots, and catastrophic late-night defects.
- In contrast, disciplined scope cutting and transparent, non-technical communication with product leadership protects delivery integrity. Stakeholders can always adapt to reduced scope; they cannot recover from missed deadlines, silent failures, and broken trust.
