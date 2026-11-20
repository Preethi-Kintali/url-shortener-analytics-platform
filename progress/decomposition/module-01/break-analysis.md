# Module 01 — Step 5: Break Analysis (Specification Contradiction)

## Executive Summary
This document analyzes a severe specification bug introduced by an uncoordinated product update to Paragraph 1 of the SkillSwap specification, creating an architectural contradiction between provider policy autonomy and a mandatory platform-wide refund rule.

---

## 1. The Core Contradiction

### The Competing Business Rules
1. **Rule A (Original Spec):** *"Cancel bookings with the provider's cancellation policy applied."*
   - Providers maintain commercial autonomy to dictate cancellation grace periods, refund ratios, and rescheduling conditions tailored to their specific skill category.
2. **Rule B (Operations Update):** *"All cancellations made within 24 hours of booking receive a full refund, regardless of the reason. Cancellations after 24 hours are non-refundable."*
   - Mandates a universal, non-negotiable platform policy that treats all services homogeneously and strips providers of policy control.

### The Critical Temporal Ambiguity
The phrase *"within 24 hours of booking"* creates catastrophic operational divergence:
- **Interpretation 1 (Creation Grace Period):** $\Delta t \le 24\text{ hours}$ from `booking_created_at`.
- **Interpretation 2 (Lead Time Before Session):** $t_{\text{cancel}} \le t_{\text{session}} - 24\text{ hours}$.
- **The Exploit Scenario:** If a learner books a session 3 hours before start time, and cancels 30 minutes later, under Interpretation 1 they receive a 100% refund (since booking was made <24h ago), while the provider turned down other clients and receives zero compensation.

---

## 2. Operational, Financial & Architectural Blast Radius

### Provider Marketplace Decay
- Providers suffer uncompensated last-minute calendar burn, eroding platform retention and prompting high-value providers to bypass the platform.
- Unpredictable revenue streams create friction with marketplace support.

### Learner Experience Inconsistencies
- Different microservices or UI components calculating refunds under different assumptions (e.g. mobile app displaying provider policy while backend gateway executes the 24h global rule).

### Platform Accounting & Financial Drift
- Payment gateway interchange fees (typically 2.9% + \$0.30) are non-refundable by Stripe/Adyen upon customer refund. If the platform issues a 100% refund, the platform loses money on every cancellation.
- Asynchronous webhook desynchronization: Booking service marks session cancelled, but payment ledger retains commission or double-credits payouts.

---

## 3. Reconciliation Proposal: The Bounded Hybrid Policy
To permanently resolve this conflict, the engineering team presents the following reconciliation model to the Product Manager:

1. **Standardized Platform Enum Tiers:** Rather than arbitrary free-text, the platform defines three validated policy tiers:
   - **Flexible:** 100% refund up to 24h before session start; 50% thereafter.
   - **Moderate:** 100% refund up to 48h before session start; non-refundable within 48h.
   - **Strict:** 100% refund up to 7 days before session start; non-refundable within 7 days.
2. **Statutory Cooling-Off Guardrail:** A universal 2-hour "instant regret" grace period immediately following booking creation, *provided* the session start time is at least 24 hours away.
3. **Immutable Policy Snapshots:** The active policy terms are snapshotted and serialized into `booking.cancellation_policy_snapshot` at checkout time, preventing retroactive changes if a provider updates their profile settings later.
4. **Single Source of Truth Calculation:** Refund calculations reside strictly within the core billing engine, ensuring booking status, refund dispatches, and provider payout ledgers are atomically reconciled.
