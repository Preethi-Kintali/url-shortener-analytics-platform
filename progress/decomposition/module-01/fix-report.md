# Module 01 – Step 6: FIX Report
## Contradiction Reconciliation & Architectural Tension Analysis

### 1. Concrete Policy Options for PM Decision

To resolve the binary contradiction between provider policy autonomy (Original Spec) and the blanket 24-hour refund mandate (Operations Update), two implementable options have been formulated:

#### Option 1: Platform-First Universal Cancellation Policy
- **The Rule:** The platform standardizes a single universal policy across all bookings:
  - Cancellations made $\ge 48\text{ hours}$ before session start: 100% refund.
  - Cancellations made between 24 and 48 hours before session start: 50% refund.
  - Cancellations made $< 24\text{ hours}$ before session start: 0% refund (non-refundable; 85% disbursed to provider, 15% platform fee).
  - 1-hour immediate post-checkout cooling-off window (100% refund) provided the session start is $>2\text{ hours}$ away.
- **Stakeholder Impact:**
  - *Learners:* Zero cognitive overhead; identical transparent policy across all services.
  - *Providers:* Loss of autonomy to set custom commercial terms; may decline same-day listings.
- **Architectural Trade-off & Complexity:** Low complexity. Single static rule engine, simple DB representation, clean UX. Sacrifices supply flexibility for demand consistency.

#### Option 2: Provider Tiered Policy with Platform Cooling-Off Floor (Recommended)
- **The Rule:** Providers select one of three platform-standardized tiers during service creation:
  - *Tier A (Flexible):* 100% refund up to 24 hours prior to session start.
  - *Tier B (Moderate):* 100% refund up to 72 hours prior; 50% between 24 and 72 hours; non-refundable within 24 hours.
  - *Tier C (Strict):* 50% refund up to 7 days prior; non-refundable within 7 days.
  - *Universal Platform Floor:* 100% statutory refund if cancelled within 2 hours of checkout, provided session start is $\ge 12\text{ hours}$ away.
- **Stakeholder Impact:**
  - *Learners:* Protected against accidental clicks/misbookings; policy clearly displayed at checkout.
  - *Providers:* Retain pricing and schedule risk control aligned with session preparation needs.
- **Architectural Trade-off & Complexity:** Moderate complexity. Requires snapshotting policy tier on the booking record at checkout time (immutable point-in-time contract), multi-tier refund calculation logic, countdown UI badges, and refund ledger audit trail.

---

### 2. Specification Updates & Downstream Blast Radius

In `artifacts/requirements/requirements-matrix.md`:
- **REQ-08 Status:** Formally marked as `BLOCKED - pending PM decision`.
- **Downstream Affected Requirements Identified:**
  - **REQ-06 (Payment Flow):** Determines whether card charges are immediately captured or held until the statutory cooling-off window elapses.
  - **REQ-09 & REQ-10 (Provider Settings):** Determines if provider onboarding and listing forms include cancellation tier selectors.
  - **REQ-11 (Provider Earnings Dashboard):** Requires clear categorization of earnings (`Escrow / Pending Refund Window` vs `Available for Payout` vs `Refunded / Forfeited`).
  - **REQ-12 (Platform 15% Commission):** Dictates whether platform commission is returned or retained to absorb payment gateway pass-through fees.
  - **REQ-16 (Dispute Mediation):** Provides the explicit contractual baseline for admin arbitration in edge cases.

---

### 3. Deeper Architectural Tensions in SkillSwap

Beyond explicit contradictions, three fundamental requirement tensions pull the architecture in competing directions:

1. **Provider Availability Autonomy vs High-Concurrency Scale (REQ-09 vs REQ-19 / REQ-05):**
   - *Conflict:* Provider wants dynamic real-time slot editing, while thousands of concurrent learners attempt booking without collisions.
   - *Resolution:* Distributed Redis TTL leases (`HELD` state for 10 minutes) with pessimistic/serializable database locks on final checkout commit.

2. **Instant Frictionless Checkout vs Anti-Fraud Escrow & Payout Safety (REQ-06 vs REQ-12 / REQ-14 / REQ-16):**
   - *Conflict:* 1-click booking UX vs preventing fraudulent providers from booking phantom sessions and withdrawing funds immediately.
   - *Resolution:* Immediate learner capture into custodial escrow; automated provider payout scheduled $T+24\text{ hours}$ post-session completion.

3. **"Analytics on Everything" Telemetry vs Sub-200ms Latency SLA (REQ-17 vs REQ-02):**
   - *Conflict:* Granular write-heavy telemetry on every action vs $<200\text{ms}$ query latency under load.
   - *Resolution:* Strictly asynchronous fire-and-forget telemetry streams decoupling analytics ingestion from the synchronous user request loop.
