# SkillSwap — Stakeholder Pressure Test & Break Analysis (Module 04 Step 5)

## 1. Context & Incident Description
- **Stakeholder Request:** Product Manager urgently requests adding live/test-mode payments to the upcoming Friday investor demo because the lead investor feels a "booking-without-payment demo would be concerning."
- **Core Dilemma:** Payment processing was an intentional, explicit anti-scope item in Slice 1 (Browse & Book Walking Skeleton). Merging payments into Slice 1 threatens delivery velocity, inflates failure surface area, and destroys clean observability of booking UX vs. payment gateway errors.

---

## 2. Decision: Option D (Hybrid Decoupled Spike & Disciplined Pushback)

### Tactical Communication to Product Manager:
> *"We can absolutely satisfy the investor's requirement to see money flow through the platform by next Friday, while protecting the delivery of our core marketplace booking experience.*
>
> *Here is the recommended execution plan:*
> 1. **Keep Slice 1 Pristine:** Maintain Slice 1 (Browse & Book) focused entirely on validating demand-side user friction and booking completion without payment blockers.
> 2. **Build Slice 1.5 (Decoupled Payment Spike):** In parallel, execute a time-boxed technical spike demonstrating an isolated Stripe test-mode transaction (checkout session, authorization, webhook receipt, and ledger record).
> 3. **The Investor Demo Presentation:** We present both capabilities side-by-side:
>    - **Part 1:** Demonstrates the end-to-end learner booking journey (discovering a mentor, selecting a slot, securing a booking).
>    - **Part 2:** Demonstrates our payment rails processing a real-time card charge with instant ledger accounting.
>
> *If the investor insists that payments MUST be physically embedded inside the primary booking journey by Friday, that represents a 2x expansion of Slice 1. To hit Friday's deadline with an integrated flow, we must formally cut scope elsewhere: we would need to eliminate all database persistence (making bookings in-memory only) or drop two of the three provider profiles. Please confirm if you want to proceed with the dual-demo strategy or make explicit scope cuts."*

---

## 3. Scope & Acceptance Criteria for Slice 1.5 (Payment Spike)
To prevent the spike from expanding uncontrollably, strict boundaries are established:
1. **Time-Box:** Maximum 8 engineering hours.
2. **Dedicated Scope:**
   - Standalone `/demo/payment-spike` checkout test page.
   - Hosted Stripe Checkout or Elements in test mode (`4242...` cards).
   - Backend webhook receiver validating Stripe cryptographic signatures (`stripe-signature`).
   - Idempotent event handler writing simulated transaction records to a test database table.
3. **Explicit Anti-Scope for Slice 1.5:**
   - No connection to the real booking schedule engine.
   - No automated payouts to provider bank accounts.
   - No multi-currency conversion, sales tax, or VAT logic.
   - No automated customer dispute or refund chargeback tooling.

---

## 4. Trade-Off Analysis
| Dimension | What We Gain | What We Trade Away |
|---|---|---|
| **Delivery Certainty** | Guarantees a working demo on Friday; prevents payment gateway issues from breaking the core booking demo. | Additional engineering coordination required to manage two parallel demo tracks. |
| **System Cleanliness** | Keeps Slice 1 architecture decoupled, clean, and easily testable. | The investor sees payment demonstrated on a dedicated page rather than inline inside the booking form. |
| **Risk Isolation** | Isolates external Stripe API latency and webhook edge cases from core marketplace logic. | Advanced production payment requirements (payouts, dispute queues) remain deferred. |

---

## 5. Scope Creep Defense & Governance Protocol
To safeguard the engineering team from recurring mid-sprint scope inflation:
1. **Acceptance Criteria Freeze:** Slice 1 acceptance criteria are locked; zero payment commits are permitted on the Slice 1 repository branch.
2. **Autonomous Spike Isolation:** Slice 1.5 operates as a standalone experimental branch with dedicated time limits and distinct acceptance criteria.
3. **Formal Change Request Protocol:** Any new stakeholder request during an active sprint must pass a mandatory impact triage: *What existing scope is being traded away to accommodate this?*
4. **Buffer Reservation:** The 24 hours preceding the investor demo are reserved strictly for end-to-end rehearsal and dry runs, not active feature development.
