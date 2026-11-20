# Module 03 – Step 1: CONTEXT
## Risk Ranking & Uncertainty Analysis

### 1. Risk Hierarchy

| Rank | Task | Risk Level | Primary Risk Driver | Rationale & Blast Radius |
|:---:|---|:---:|:---:|---|
| **1** | **Task B: Integrate Stripe Payment API** | **Highest Risk** | External Dependency & Financial Liability | Third-party API outside direct control. High volume of unknowns: payment capture vs hold semantics, webhook retries/dropped events, idempotency keys, currency precision, non-refundable platform commission deductions, and regulatory compliance. Failures directly corrupt financial records and stop the business. |
| **2** | **Task A: Design Provider Profile DB Schema** | **Medium Risk** | Architectural Blast Radius & Data Migration Lock-in | Full internal engineering control, but foundational structural blast radius. Flawed schema fields, unindexed query patterns, or missing lifecycle states (`DRAFT` vs `APPROVED`) cascade into catalog search, availability filters, and dashboard reporting. Hard to mutate without expensive data migrations once populated. |
| **3** | **Task C: Build User Profile CRUD Form** | **Lowest Risk** | Known Implementation Pattern | High familiarity, standard patterns, zero external dependencies. Standard input validation, basic controller update, low architectural blast radius. Even if poorly implemented initially, it can be refactored locally in hours without breaking downstream subsystems. |

---

### 2. De-Risking Unknowns via Time-Boxed Technical Spikes
- **What is a Spike?** A disposable, time-boxed scouting mission (typically 2 to 4 hours) designed to eliminate uncertainty and validate critical technical assumptions before writing production infrastructure.
- **Applying a Spike to Task B (Stripe Integration):**
  - Spin up a minimal script using Stripe CLI and test-mode API keys.
  - Verify end-to-end tokenized payment charge creation.
  - Test asynchronous webhook listener handling duplicate webhook delivery (simulating network replay).
  - Verify partial refund calculation and reversal mechanics.
  - *Outcome:* Proves external API compatibility and settles interface assumptions for negligible cost on Day 1 rather than discovering rate limits or webhook mismatch on Day 30.
