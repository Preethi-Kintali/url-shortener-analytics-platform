# Module 01 — Step 2: Architecture & Planning Decision

## Selected Decision: Option B — Categorized Matrix (Stakeholder × Type Grid)

### Context & Tradeoff
When extracting requirements from ambiguous multi-page product specifications, the structure chosen dictates downstream usability during dependency mapping, slicing, and sprint planning:
- **Option A (Flat List):** Rapid to assemble, single-index list, but easily obscures omissions and creates an unsearchable wall of text once requirements exceed 20+ items.
- **Option B (Categorized Matrix):** Two-dimensional taxonomy grouping items by **Stakeholder** (*Learner*, *Provider*, *Admin/Platform*) and **Type** (*Functional*, *Constraint*, *Quality Attribute*).

### Rationale & Defense
1. **Multi-Sided Marketplace Complexity:** SkillSwap inherently balances three distinct actors with conflicting incentives (Learners wanting instant discovery and flexible cancellation; Providers wanting guaranteed time utilization and timely payouts; Platform Ops requiring dispute mediation, commission deduction, and multi-city scale). A flat list blurs these critical boundaries.
2. **Immediate Gap Visibility:** In a categorized matrix, an empty cell (e.g. "Provider Quality Attributes" or "Admin Constraints") acts as an instant visual alert indicating an unexplored architectural area before implementation begins.
3. **Traceability to Downstream DAGs:** Module 02 (Dependency Mapping) and Module 04 (Vertical Slicing) require tracing capabilities through user journeys. The matrix structure maps directly to end-to-end vertical slices.
4. **Engineering Estimation Accuracy:** Grouping quality attributes (e.g. concurrency double-booking prevention, sub-200ms search) alongside functional user stories prevents developers from treating non-functional requirements as afterthoughts.
