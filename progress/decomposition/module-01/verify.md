# Module 01 — Step 4: Verification Report (Requirements Pressure-Testing)

## Executive Summary
This document records the empirical pressure-testing and assumption validation of the 20 extracted requirements for **SkillSwap**, resolving the gap between surface text and operational execution.

---

## 1. Confidence Extremes Analysis

### Three Most Confident Requirements
1. **REQ-01 (Category Browsing):** Directly stated and foundational to marketplace discovery. Low ambiguity regarding intent: users need structured taxonomy endpoints to filter offerings.
2. **REQ-03 (Provider Profile Views):** Unambiguous user story. Profiles aggregate provider bio, certifications, and historical reviews to establish trust prior to transaction commitment.
3. **REQ-05 (Zero Double-Booking Concurrency):** Fundamental transactional invariant. A provider can only be booked for one learner per time slot; failure here breaks marketplace credibility.

### Three Least Confident Requirements (Operational Hazards)
1. **REQ-12 (Commission Mechanics & Payout Timing):** The spec mandates a 15% commission, but remains silent on settlement timing, payout escrow windows, banking rails, chargebacks, and ledger accounting.
2. **REQ-08 (Cancellation & Refund Policy):** "With provider policy applied" leaves open who absorbs merchant gateway interchange fees on refunds, whether policies are standardized tiers or free-text, and the exact cutoff hours.
3. **REQ-14 (Provider Vetting Depth):** "Vetting new providers" lacks legal and operational boundaries (automated identity vs manual document review vs background checks) and has zero specification for appeal or reapplication flows.

---

## 2. Quantitative & Architectural Resolution of Probing Questions

### Probing Question 1: Quantifying "Feel Instant"
- **Service Level Objective (SLO):**
  - **p95 Latency:** $\le 500\text{ms}$
  - **p99 Latency:** $\le 1000\text{ms}$
- **Operational Conditions:** Evaluated under production peak load with warm Redis caches and composite database indexes on `(category_id, city_id)`. Excludes client-side browser render and mobile cell network overhead.

### Probing Question 2: Modeling "Cancellation Policy Applied" Money Flow
- **State Transition Flow:**
  1. Learner triggers cancellation via `POST /bookings/:id/cancel`.
  2. Core service evaluates current timestamp against `slot_start_time` and the provider's active policy tier.
  3. Eligible refund amount ($R = \text{gross} \times \text{tier\_percent}$) is computed.
  4. Platform triggers asynchronous refund request to payment gateway with idempotency key.
  5. Immutable ledger entry records refund transaction and releases calendar slot lease.
- **Fee Handling:** Platform absorbs payment gateway processing fees if cancellation is initiated by provider or system fault. Learner-initiated late cancellations deduct non-refundable processing fees as disclosed during checkout.

### Probing Question 3: Defining the "Vetting Process"
- **Hybrid Vetting Model:**
  - Automated verification: Email validation, SMS phone verification, and third-party KYC identity checks.
  - Manual review: Operations team inspects credentials, certifications, and portfolio links.
- **Provider State Machine:**
  $$\text{DRAFT} \longrightarrow \text{PENDING\_VETTING} \longrightarrow \text{APPROVED} \quad \text{or} \quad \text{REJECTED} \ / \ \text{SUSPENDED}$$
- Reapplication allowed after correcting identified submission deficiencies.

### Probing Question 4: Scoping "Analytics on Everything" for MVP
- **Pragmatic Scope Control:** Reject building an enterprise real-time data warehouse before launch.
- **Lean Event Stream:** Asynchronously publish structured domain events to a lightweight queue:
  - Account events (`user_registered`, `provider_verified`)
  - Discovery events (`search_executed`, `profile_viewed`)
  - Commerce events (`slot_held`, `booking_confirmed`, `payment_failed`, `booking_cancelled`)
  - Reliability telemetry (API latencies, 5xx error rates, worker job failures)
