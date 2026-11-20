# Module 08 — Ship It
## Step 2: DECIDE — Ship Readiness: Production-Grade vs. Ship & Iterate

**Course**: Upsk AI-Augmented Engineering (Pack 3: Operator)  
**Module**: 08 — Ship It  
**Step**: STEP 2: DECIDE — Ship Readiness  
**Date**: November 19, 2026  
**Decision**: **Option B: Production-Grade**  
**Auditor**: Tech Lead / Operator  

---

## 1. Trade-Off Analysis: Option A vs. Option B

| Evaluation Dimension | Option A: Ship and Iterate | Option B: Production-Grade (Selected) |
| :--- | :--- | :--- |
| **Release Velocity** | Immediate; ships core happy paths and basic docs. | Deliberate; ships only when test, doc, and CI gates pass. |
| **Security Risk Profile** | **HIGH**. Silent authorization regressions or IDOR flaws leak to production. | **LOW**. Every authorization boundary and tenant barrier is gate-checked. |
| **Failure Mode** | Runtime customer data breach, cross-tenant leak, or deployment rollback failure. | Slower time-to-first-release. |
| **CI Integration** | Manual / ad-hoc test execution; unpinned dependencies. | Fully automated single-signal CI pipeline running on every commit. |
| **Documentation State** | Tribal knowledge; breaks when new engineers onboard. | Complete, self-contained architecture guides and API contracts. |
| **Rollback Preparedness** | "Push to main and pray"; undefined database rollback. | Documented backward-compatible expand-and-contract rollback plan. |

---

## 2. Answers to Probing Questions

### 1. What is the cost of a regression in production versus delayed shipping?
> In an enterprise collaboration platform handling multi-tenant team memberships, invitations, and role hierarchies, the cost of a security regression is catastrophic. A single IDOR flaw or privilege escalation bug allows external users to access competitor data or elevate themselves to team administrators. Trust lost from a data breach takes years to rebuild and carries legal/compliance penalties. Delaying the release by hours to harden CI and regression test coverage is negligible compared to the existential risk of a breach.

### 2. What is the highest-probability failure mode if we ship right now?
> The highest-probability failure is **Environment & Pipeline Divergence**: code and tests that pass cleanly on a single developer's machine failing in CI or production due to missing environment variables, unpinned transient dependencies (`pnpm-lock.yaml`), unseeded database states, or unhandled asynchronous event timing. Without an automated CI pipeline with clear pass/fail gates, this divergence goes undetected until customer deployment.

### 3. The Five Essential Tests:
If restricted to writing only five tests, they must protect against the five silent, high-damage failure modes:
1. **Cross-Tenant Boundary Isolation**: Proves User A from Team Alpha cannot view, modify, or invite members to Team Beta (strict HTTP 403/404).
2. **Privilege Escalation & Self-Modification Guard**: Proves an authenticated VIEWER or MEMBER cannot promote themselves or modify roles on `PUT /teams/:id/members/:uid` (HTTP 403).
3. **Unauthenticated Principal Rejection**: Proves unauthenticated callers or arbitrary client headers (`X-User-Id`) cannot bypass cryptographic JWT authentication (HTTP 401).
4. **WebSocket Monotonic Event Sequencing**: Proves real-time event downlink delivers strictly monotonic, un-duplicated sequences with historical replay before live stream ingestion.
5. **Atomic Audit Trail Recording**: Proves every role change and sensitive mutation creates an immutable audit record within the transaction boundary.

---

## 3. Official Decision Statement & Defended Scope

We formally select **Option B: Production-Grade**:
- **What We Will Ship**:
  1. Complete automated regression test harness unifying all authorization, tenant isolation, and WebSocket replay checks.
  2. Automated CI pipeline configuration (`.github/workflows/ci.yml`) enforcing a single unambiguous green/red gate.
  3. Comprehensive operator documentation detailing component topology, onboarding guide, and API contracts.
  4. Documented zero-downtime rollback and database migration plan.
- **Why This Trade-Off Is Acceptable**:
  Investing time in production readiness eliminates downstream firefighting, guarantees multi-tenant safety, and transforms an AI demo into enterprise-grade production software.
