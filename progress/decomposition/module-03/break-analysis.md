# Module 03 – Step 5: BREAK Analysis
## The Non-Technical Blocker: Business & Legal Risk Diagnosis

### 1. Categorizing the Blocker: Business & Legal Risk
The client's lack of a registered legal business entity and merchant bank account is not an engineering bug or code defect. It represents a **Business & Legal Risk**—an external compliance and organizational prerequisite completely outside the codebase.

#### Comparison Across the Risk Spectrum:
- **Technical Risks (Integration, Novelty, Dependency, Scale):** Solvable through architecture, interface contracts, spike experiments, and code refactoring.
- **Business/Legal Risks:** Involve statutory filings, banking compliance (KYC/AML), corporate tax registration, and payment gateway underwriting. They cannot be solved by engineering, but engineering must proactively **plan around them**.

---

### 2. Strategic Impact on the Risk-First Build Sequence
- **Status of Live Stripe Integration (`WI-08`):** Formally flagged as `BLOCKED - awaiting client merchant entity registration (4–6 weeks)`.
- **Mitigating the 6-Week Stall:** If engineering halted until merchant accounts were active, the entire team would idle for over a month. Halting is unacceptable; instead, the team decouples internal transaction logic from live banking rails.
- **Dynamic Re-Prioritization:**
  - Pull forward **`WI-06: Slot Hold & Concurrency`** (Top Novelty/Scale Risk) to be retired immediately.
  - Complete **`WI-04: Availability Engine`** and **`WI-07: Booking State Machine`**.
  - Isolate payment integration behind an explicit architectural boundary.

---

### 3. The Architectural Solution: Payment Provider Abstraction Layer

To prevent business paperwork from blocking software delivery, we introduce an abstract **Payment Gateway Interface (`PaymentProviderContract`)**:

```text
┌───────────────────────────────────────┐
│     Booking & Reservation Engine      │
└───────────────────┬───────────────────┘
                    │
                    │ Depends on interface contract
                    ▼
┌───────────────────────────────────────┐
│       PaymentProviderContract         │
│  - createCheckoutSession(params)      │
│  - capturePayment(paymentId)          │
│  - processRefund(paymentId, amount)   │
│  - parseWebhook(payload, signature)   │
└───────────┬───────────────────────┬───┘
            │                       │
     Implements              Implements
            │                       │
            ▼                       ▼
┌───────────────────────┐ ┌───────────────────────┐
│ MockPaymentAdapter    │ │ StripePaymentAdapter  │
│ (Active on Day 1:     │ │ (Configured once      │
│  deterministic test   │ │  merchant account     │
│  state transitions)   │ │  activates)           │
└───────────────────────┘ └───────────────────────┘
```

#### Key Capabilities Unlocked by the Mock Adapter:
1. **Unblocks Core Workflows:** Booking reservation, cancellation fee calculations, double-entry commission ledgers, and confirmation notifications develop and test against realistic simulated states.
2. **Deterministic Edge-Case Simulation:** Simulates edge cases on demand (card declined, network timeout, duplicate webhook delivery, chargeback) without paying live processing fees.
3. **Production Safety Boundary:** Mock transactions are segregated via explicit `payment_environment: 'sandbox' | 'live'` flags; live payment processing remains gated behind an environment configuration kill-switch until underwriting clears.
