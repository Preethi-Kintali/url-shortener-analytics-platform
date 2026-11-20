# Module 03 – Step 4: VERIFY
## Risk-First Plan Verification & Stress Testing

### 1. Risk Retirement Walkthrough: Spikes & Foundation
By prioritizing exploratory spikes (`S-01`, `S-02`) and foundational infrastructure (`WI-01`, `WI-02A/B`), the team transforms critical unknowns into empirical facts:
- **Stripe API Capabilities (S-01):** Validates regional payment rails, 15% commission splitting, webhook signature verification, and idempotent duplicate-event deduplication.
- **Concurrency & Double-Booking Prevention (S-02):** Validates distributed Redis TTL leases under simulated 50-request concurrent spikes, confirming atomic lock acquisition and graceful HTTP 409 conflict responses.
- **Tenancy & Onboarding (WI-01, WI-02A/B):** Establishes multi-city tenant boundaries (`city_id`) and proves the `PENDING_REVIEW` $\to$ `APPROVED` provider lifecycle.
- **Retired Risks:** Integration Risk (Score 5) and Concurrency Novelty Risk (Score 4) are retired before writing a single line of production transaction code.

---

### 2. The Early Failure Test
- **Failure Scenario:** Spike 1 discovers that Stripe Connect custom payout splits are unsupported in our primary launch region, or WI-01 reveals that cross-city data isolation violates serializable lock guarantees.
- **Cost Incurred:** 4 hours of throwaway spike code or 2 days of initial schema design.
- **Value Saved:** Prevents spending 30 to 60 business days building a multi-city catalog, frontend search UI, and booking calendar on top of an unviable financial or data architecture. Sunk cost is capped at hours rather than months.

---

### 3. Foundational vs. Risky: The Auth Distinction
- **Foundational (High Dependency):** Components that sit at the root of the DAG upon which many downstream systems depend (e.g. User Authentication, Database Connection Pooling). Dependency asks: *"How many systems are blocked until this is done?"*
- **Risky (High Uncertainty):** Components with unknown failure modes, external third-party dependencies, or novel concurrency boundaries (e.g. Stripe Webhooks, Redis Distributed Leases). Risk asks: *"How likely is this to surprise or fail us?"*
- **Execution Rule:** Auth is low-risk, high-dependency. We build it early not because it is scary, but because it unblocks the high-risk transaction engines.

---

### 4. The 5-Item Demo Slice (Bridge to Vertical Slicing)
To demonstrate the core business hypothesis with only five components:
1. `WI-01` – Auth & Tenancy Core (Identity foundation)
2. `WI-03` – Provider Catalog & Pricing (Seeded provider inventory, bypassing heavy onboarding)
3. `WI-04 + WI-06` – Availability & Slot Hold (Zero double-booking guarantee)
4. `WI-07` – Booking Flow & Reservation (Active reservation state machine)
5. `WI-08` – Payment Gateway & Commission Ledger (Stripe checkout and fee capture)

*Insight:* The 5-item demo slice optimizes for **business value demonstration**, while the risk pipeline optimizes for **uncertainty reduction**. Combining pre-build spikes with a thin vertical slice satisfies both needs, forming the exact bridge to Module 04 (Vertical Slicing).
