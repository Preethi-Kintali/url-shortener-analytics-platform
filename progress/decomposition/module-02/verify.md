# Module 02 – Step 4: VERIFY
## Dependency Graph Verification & Stress Testing

### 1. Critical Path Check
- **Longest Hard-Dependency Chain:**
  $$\text{WI-01} \to \text{WI-02} \to \text{WI-03} \to \text{WI-04} \to \text{WI-06} \to \text{WI-07} \to \text{WI-08} \to \text{WI-10}$$
- **Chain Work Items & Estimates:**
  1. `WI-01` – Auth & Tenancy Core: 2 days
  2. `WI-02` – Provider Vetting & Onboarding: 2 days
  3. `WI-03` – Provider Catalog & Pricing: 2 days
  4. `WI-04` – Availability & Schedule Engine: 3 days
  5. `WI-06` – Slot Hold & Concurrency Control: 3 days
  6. `WI-07` – Booking Flow & Reservation: 2 days
  7. `WI-08` – Payment Gateway & Commission Ledger: 3 days
  8. `WI-10` – Cancellation & Refund Engine: 2 days
- **Structural Depth:** 8 levels.
- **Minimum Project Duration Floor:**
  $$2 + 2 + 2 + 3 + 3 + 2 + 3 + 2 = \mathbf{19\text{ business days}}$$
  *(Note: Parallel hard-dependency branches ending at `WI-11` and `WI-12` also total 19 days, requiring equal operational vigilance).*

---

### 2. The "Double Time" Failure Drill

#### Drill A: WI-06 (Slot Hold & Concurrency) takes 6 days instead of 3
- **Direct Downstream Impact:** Blocks `WI-07` (Booking Flow).
- **Transitive Blast Radius:** Delays `WI-08` (Payments), `WI-09` (Booking Confirmations), `WI-10` (Refunds), `WI-11` (Earnings Dashboard), and `WI-12` (Dispute Resolution).
- **Unaffected Workstreams:** `WI-01`, `WI-02`, and `WI-03` are already complete. `WI-04` is complete. `WI-05` (Instant Search) continues completely unhindered.
- **Project Timeline Impact:** Slips overall delivery floor day-for-day from **19 to 22 business days**.

#### Drill B: WI-08 (Payment Gateway & Ledger) takes 6 days instead of 3
- **Direct Downstream Impact:** Blocks `WI-10` (Refund Engine), `WI-11` (Earnings Dashboard), and `WI-12` (Dispute Mediation).
- **Unaffected Workstreams:** `WI-01` through `WI-07` are already delivered. `WI-05` (Search) is unaffected. `WI-09` (Notifications) can build its core worker against mock payment events.
- **Project Timeline Impact:** Adds 3 business days to the downstream release floor (22 business days).

---

### 3. Graph Integrity & Traceability

#### Path to Value (Zero Code to Learner Booking):
$$\text{WI-01 (Auth)} \to \text{WI-02 (Vetting)} \to \text{WI-03 (Catalog)} \to \text{WI-04 (Schedules)} \to \text{WI-06 (Hold)} \to \text{WI-07 (Booking)} \to \text{WI-08 (Payment)}$$
A complete end-to-end user booking requires exactly these 7 prerequisite milestones.

#### Isolated Nodes & Red Flags:
- **Zero Orphaned Nodes:** All 12 work items connect into the unified directed graph.
- **No False Bottlenecks:** Search (`WI-05`) does not wait for Auth or Booking. Notifications (`WI-09`) does not block checkout. Dashboard (`WI-11`) does not block core transactions.
- **Architectural Nuance Identified:** Flagged the lifecycle state transition in `WI-07`—ensuring `CONFIRMED` status is only committed upon successful `WI-08` payment capture, with automated TTL expiration releasing abandoned `HELD` slots.

#### Onboarding Clarity:
- `WI-01` is immediately identifiable as the sole Day 1 technical starting point (In-degree = 0).
- While the DAG establishes sequencing and parallel tracks, handing work to new engineers also requires detailed task specifications, explicit interface contracts, and acceptance criteria (addressed in Module 05).
