# SkillSwap Risk-First Execution Plan (Updated: Post-Blocker Resolution)

## Executive Summary
This document captures the restructured **Risk-First Execution Plan** for SkillSwap following the discovery of a non-technical **Business & Legal Blocker**: the client lacks a registered legal entity and Stripe merchant account (4–6 week lead time).

Rather than stalling engineering operations, the plan isolates the external dependency by introducing a **`PaymentProviderContract` with a deterministic `MockPaymentAdapter`**. This allows core booking, concurrency, scheduling, and notification engines to proceed without delay while live payment integration is queued behind an explicit merchant readiness gate.

---

## 1. Work Item Risk & Blocker Annotations

| ID | Title | Est. Duration | Risk Score | Risk Types | Status & Blocker Impact |
|---|---|:---:|:---:|---|---|
| **WI-01** | **Auth & Tenancy Core** | 2 days | **2** | Dependency, Scale | **Active:** Unblocked. Establishes multi-city tenant key `city_id`. |
| **WI-02A** | **Provider Onboarding Schema** | 1 day | **2** | Dependency | **Active:** Unblocked. Establishes `PENDING_REVIEW` state machine. |
| **WI-02B** | **Admin Review Tool (Minimal)** | 1 day | **1** | None | **Active:** Unblocked. Single endpoint / CLI to approve providers. |
| **WI-03** | **Provider Catalog & Pricing** | 2 days | **1** | None | **Active:** Unblocked. Seeded & approved provider profiles. |
| **WI-04** | **Availability & Schedule Engine** | 3 days | **3** | Novelty | **Active (PRIORITY PULLED FORWARD):** Timezone normalization and slot generation. |
| **WI-06** | **Slot Hold & Concurrency Control** | 3 days | **4** | Novelty, Scale | **Active (TOP REMAINING RISK):** Distributed Redis TTL leases & zero double-booking lock. |
| **WI-07** | **Booking Flow & Reservation** | 2 days | **2** | Dependency | **Active:** State machine transitioning `HELD` $\to$ `CONFIRMED`. |
| **WI-08A** | **Payment Interface Contract & Mock Stub** | 1 day | **1** | Contract | **Active (REPLACES WI-08):** Defines `PaymentProviderContract` and `MockPaymentAdapter`. |
| **WI-08B** | **Live Stripe & Commission Integration** | 3 days | **5** | Integration, Legal | **BLOCKED:** Gated on client merchant entity paperwork (4–6 weeks). |
| **WI-09** | **Notification Service** | 1 day | **1** | Integration | **Active:** Asynchronous email queue listening to booking events. |
| **WI-10** | **Cancellation & Refund Logic (Contract)** | 2 days | **3** | Policy | **Active:** Implements refund fee calculations against mock payment reversals. |
| **WI-11** | **Provider Dashboard & Payouts** | 2 days | **2** | None | **Active:** Read-model ledger display based on simulated transactions. |
| **WI-12** | **Dispute Resolution & Telemetry** | 2 days | **2** | Novelty | **Active:** Admin dispute workflows and structured audit telemetry. |
| **WI-13** | **Full Admin Dashboard Console** | 2 days | **1** | None | **Active:** Web console for analytics and bulk provider management. |

---

## 2. Formal PM Escalation Notice

The following formal communication has been submitted to the Product Manager:

> **Urgent Blockers & Timeline Escalation: Client Payment Rails**
>
> *"Payment processing is currently blocked on the client side: the business entity is not yet legally registered and merchant account paperwork has not been initiated (4–6 week lead time).*
>
> *To prevent an engineering stall, we have isolated the dependency behind a `PaymentProviderContract` and `MockPaymentAdapter`, allowing booking, slot concurrency, and catalog development to proceed on schedule. However, live end-to-end payment testing, commission disbursements, and production launch are hard-blocked until merchant credentials are issued. Please provide an official target date for legal clearance so we can schedule the live gateway swap."*

---

## 3. Revised Risk-First Build Sequence

With live payments decoupled, **`WI-06: Slot Hold & Concurrency`** is elevated to the primary risk target. The team progresses as follows:

```text
========================================================================================
                 REVISED RISK-FIRST EXECUTION PIPELINE (POST-BLOCKER)
========================================================================================

PRE-BUILD SCOUTING SPIKES:
  [S-02] Spike: Redis Distributed Slot Hold Concurrency (3 hours) ── Retires Novelty Risk 4

PHASE 1: FOUNDATIONS & UNBLOCKING INVENTORY
  [01] WI-01: Auth & Multi-City Tenancy Core (Risk: 2, 2d)
  [02] WI-02A: Provider Onboarding Data Schema (Risk: 2, 1d)
  [03] WI-02B: Admin Review Tool (Minimal) (Risk: 1, 1d)
  [04] WI-03: Provider Catalog & Pricing (Risk: 1, 2d)

PHASE 2: TOP TECHNICAL UNCERTAINTIES (CONCURRENCY & SCHEDULING)
  [05] WI-04: Availability & Schedule Engine (Risk: 3, 3d) ◄── [PULLED FORWARD]
  [06] WI-06: Slot Hold & Concurrency Control (Risk: 4, 3d) ◄── [TOP TECHNICAL RISK RETIRED]
  [07] WI-07: Booking Flow & Reservation (Risk: 2, 2d)

PHASE 3: TRANSACTION ABSTRACTION & CONTRACT DECOUPLING
  [08] WI-08A: Payment Interface Contract & Mock Stub (Risk: 1, 1d) ◄── [CONTRACT STUB]
  [09] WI-10: Cancellation & Refund Engine (Contract Implementation) (Risk: 3, 2d)

PHASE 4: PARALLEL TERMINAL WORKSTREAMS
  [10] WI-05: Instant Search & Discovery (Risk: 3, 2d)
  [11] WI-09: Notification Service (Risk: 1, 1d)
  [12] WI-11: Provider Dashboard & Simulated Payouts (Risk: 2, 2d)
  [13] WI-12: Dispute Resolution & Telemetry (Risk: 2, 2d)
  [14] WI-13: Full Admin Dashboard Console (Risk: 1, 2d)

PHASE 5: DEFERRED LIVE RAIL ACTIVATION (WHEN MERCHANT ACCOUNT CLEARS)
  [--] WI-08B: Live Stripe & Commission Gateway Integration (Risk: 5, 3d) ◄── [BLOCKED 4-6 WEEKS]
```

---

## 4. Architectural Payment Contract Specification

```typescript
export interface PaymentIntentRequest {
  bookingId: string;
  learnerId: string;
  providerId: string;
  amountCents: number;
  currency: 'USD';
  commissionRate: 0.15;
}

export interface PaymentIntentResult {
  transactionId: string;
  paymentStatus: 'CAPTURED' | 'HELD_IN_ESCROW' | 'FAILED';
  capturedAt: string;
  platformFeeCents: number;
  providerNetCents: number;
  environment: 'sandbox' | 'live';
}

export interface PaymentProviderContract {
  createPayment(req: PaymentIntentRequest): Promise<PaymentIntentResult>;
  verifyPayment(transactionId: string): Promise<PaymentIntentResult>;
  processRefund(transactionId: string, refundCents: number, reason: string): Promise<{ refundId: string; status: 'REFUNDED' }>;
  handleWebhook(rawPayload: string, signature: string): Promise<{ eventType: string; eventId: string }>;
}
```

### MockPaymentAdapter Guarantees:
- Returns deterministic success when `amountCents > 0`.
- Simulates credit card decline when `amountCents === 99999`.
- Emits structured events enabling BullMQ notification workers to test email dispatch.
- Strictly flags all records with `environment: 'sandbox'`, preventing accidental mix with real banking records.
