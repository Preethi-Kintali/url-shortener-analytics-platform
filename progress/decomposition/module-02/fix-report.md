# Module 02 – Step 6: FIX Report
## Circular Dependency Resolution via Node Splitting & Lifecycle States

### 1. The Core Architectural Technique: Node Splitting
When confronted with the three-node deadlock cycle:
$$\text{Provider Vetting} \to \text{Admin Dashboard} \to \text{Provider Data} \to \text{Provider Vetting}$$
we identified that the cycle was caused by treating the **Admin Dashboard** as a monolithic block that combined both the **minimum operational review mechanism** and the **rich post-launch reporting UI**.

By applying **Node Splitting**, we decomposed the feature into:
1. **`WI-02B: Admin Review Tool (Minimal)` (1 day, Critical Path):**
   - Simple API / CLI endpoint: `POST /admin/providers/:id/approve` and `POST /admin/providers/:id/reject`.
   - Reads applications in `PENDING_REVIEW` state; changes status to `APPROVED`.
   - Zero charts, zero bulk analytics, zero front-end widget overhead.
2. **`WI-13: Full Admin Dashboard (Analytics & Disputes)` (2 days, Parallel Track):**
   - Rich multi-city web console, platform telemetry visualizer, bulk provider filters, and dispute escalation tooling.
   - Decoupled from the critical path; executes in parallel as a terminal sink.

---

### 2. State Machine Integration
Coupled with node splitting, we decoupled data submission from public catalog activation:
- `WI-02A` creates provider records in `PENDING_REVIEW` status (data exists before approval).
- `WI-02B` acts on `PENDING_REVIEW` data to transition it to `APPROVED`.
- `WI-03` projects only `APPROVED` records into the bookable public catalog.

---

### 3. Verification of Cycle Elimination
- The graph transitions from a cycle into a strictly directed, acyclic flow:
  $$\text{WI-01} \to \text{WI-02A (Pending Data)} \to \text{WI-02B (Minimal Review Tool)} \to \text{WI-03 (Approved Catalog)} \to \dots \to \text{WI-13 (Full Dashboard)}$$
- Topological sort executes with zero cycles detected.

---

### 4. Critical Path & Parallelism Impact
- **Total Work Items:** Increased from 12 to 13.
- **Critical Path Duration:** Remains stable at **19 business days** ($2 + 1 + 1 + 2 + 3 + 3 + 2 + 3 + 2 = 19$).
- **Parallelism Gain:** The complex Full Admin Dashboard (`WI-13`) is completely removed from the critical path, unblocking provider onboarding on Day 3 instead of stalling until the entire administrative UI suite is completed.
