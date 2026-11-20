# SkillSwap — Slice Plan Adjustment & Fix Report (Module 04 Step 6)

## 1. Executive Summary & Strategy Selection
In response to late-breaking stakeholder pressure to demonstrate live/test-mode payment capabilities to lead investors, we adopted **Option D (Hybrid Strategy)**:
- We preserved **Slice 1 (Browse & Book Seeded Walking Skeleton)** in its pure, ultra-thin form to safeguard the core marketplace booking user journey and its baseline usability learnings.
- We inserted **Slice 1.5 (Standalone Payment Rails Spike)** as an independent, parallel 8-hour technical spike that demonstrates Stripe test-mode card processing, webhooks, and ledger tracking on a dedicated route (`/demo/payment-spike`).
- We formulated a professional, data-backed communication memo to the Product Manager outlining exact options, trade-offs, and necessary approvals.

---

## 2. Professional Communication Memo to Product Manager

```text
To: Product Management Lead
From: Senior Engineering Lead — SkillSwap Platform
Date: Friday, 5:15 PM
Subject: Re: Investor Demo Next Friday — Payment Integration Scope & Strategy

Hi [PM],

Thanks for the heads-up regarding the lead investor's demo expectations. We completely understand their desire to see money flow through the platform to validate the monetization model.

Here is our engineering assessment and recommended path forward to deliver a high-confidence demo by next Friday without compromising project stability:

1. THE ARCHITECTURAL RISK OF BLOATING SLICE 1:
Our current Slice 1 is an ultra-thin walking skeleton (Browse & Book with seeded providers). Incorporating live Stripe payment elements, webhook listening, error handling, and state transitions directly into Slice 1 doubles the build complexity (from ~3 hours to 2.5 days) and introduces third-party webhook failure modes right before the presentation. If a test card fails or Stripe's sandbox has latency during the demo, the entire booking journey breaks, giving the false impression that our core marketplace doesn't work.

2. OUR RECOMMENDED SOLUTION — PARALLEL DEMO TRACKS:
We recommend keeping Slice 1 pristine and building Slice 1.5 in parallel as a dedicated Payment Rails Spike:
- Slice 1 Demo: We walk the investor through the seamless learner journey: finding a mentor, selecting an available slot, and generating a booking confirmation.
- Slice 1.5 Demo (Dedicated route at /demo/payment-spike): We demonstrate our payment infrastructure in action: charging a test card ($50.00), verifying the real-time webhook callback, handling a simulated card decline gracefully, and inspecting the automated 80/20 platform fee ledger split.

3. TRADE-OFFS & REQUIREMENTS TO PROCEED:
- Cost: Slice 1.5 requires approximately 8 engineering hours.
- Mitigation: To protect our Friday deadline, engineering will dedicate Monday to Slice 1 completion, Tuesday to Slice 1.5 development, and Thursday afternoon to end-to-end rehearsals.
- Hard Alternative: If the investor strictly insists that payment must be physically embedded inside the primary booking form, we can do so, but we must explicitly cut other scope to absorb the 2x build expansion: we would drop persistent database storage (rendering bookings in-memory only) or drop provider profiles.

Please confirm by Monday 9:00 AM if you approve the dual-demo strategy so we can initiate development on Slice 1 and Slice 1.5 accordingly.
```

---

## 3. Detailed Specification for Slice 1.5

### Name
`Slice 1.5: Standalone Payment Rails Spike (Investor Demo Track)`

### Position in Execution Sequence
Runs in parallel with early Slice 2 development. Does not create a blocking dependency on the core marketplace sequence.

### Scope (What Is In)
- **Frontend Demo Route (`/demo/payment-spike`):**
  - High-visibility banner indicating "Investor Demo Environment — Stripe Test Mode".
  - Interactive payment card entry using Stripe Elements (`pk_test_...`).
  - Pre-set test triggers: (1) Successful Charge ($50.00), (2) Declined Card simulation, (3) Duplicate Webhook simulation.
  - Live ledger receipt showing transaction ID, amount charged, provider share ($40.00), and platform commission ($10.00).
- **Backend API & Webhook Service:**
  - `POST /api/v1/demo/payments/charge`: Invokes Stripe PaymentIntents API with test secret key.
  - `POST /api/v1/webhooks/stripe`: Validates cryptographic HMAC signature (`Stripe-Signature`), processes `payment_intent.succeeded`, and records the transaction.
  - Idempotency handler: Enforces deduplication on Stripe event IDs to prevent duplicate webhook processing.
- **Persistence:**
  - `demo_payment_transactions` table recording `{ id, stripe_payment_id, amount_cents, status, idempotency_key, created_at }`.

### Anti-Scope (What Is Explicitly Out)
- **No Coupling to Booking Form:** Zero impact on the core Slice 1 booking workflow.
- **No Live Credit Cards / Real Bank Accounts:** Strictly test-mode API keys.
- **No Automated Bank Payouts:** No Stripe Connect Express bank transfers.
- **No User Account Requirement:** Accessible without logging in.
- **No Dispute or Chargeback Tools:** Deferred to post-launch milestones.

### Acceptance Criteria
1. Open `/demo/payment-spike` in browser: observe payment demo interface with preset $50.00 coaching session fee.
2. Enter standard test card `4242 4242 4242 4242`, click "Process Test Payment": see immediate confirmation receipt with generated Stripe Charge ID.
3. Enter decline card `4000 0000 0000 0002`: verify clear error message "Card was declined by issuing bank".
4. Dispatch test webhook event: verify backend validates signature and persists transaction record.
5. Re-dispatch identical webhook event: verify system acknowledges event with HTTP 200 without duplicate database entries.

### Estimated Complexity & Time
- **S (Small — 6 to 8 hours)**

---

## 4. Scope Governance & Team Protection Rules
1. **Repository Branch Isolation:** Slice 1 remains on `feat/slice-1-browse-book`; Slice 1.5 is developed strictly on `spike/payment-demo`.
2. **Acceptance Criteria Lock:** No changes are permitted to Slice 1 acceptance criteria.
3. **Demo Rehearsal Buffer:** Thursday afternoon is locked for staging deployment and demo rehearsal; no new feature code may be merged after Thursday 12:00 PM.
