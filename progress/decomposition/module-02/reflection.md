# Module 02 – Step 7: REFLECT
## Dependency Mapping & Critical Path Retrospective

### 1. Practical Utility & Team Communication
- **The Graph as an Execution Map:** The dependency graph provides an unambiguous visual representation of execution ordering, hard prerequisites, parallel branches, and single-point-of-failure bottlenecks.
- **Onboarding Clarity:** A new engineer on Day 1 can immediately see that `WI-01` (Auth & Tenancy Core) is the unblocked root starting point. However, translating a DAG into execution requires pairing node topology with detailed task specifications, interface contracts, and acceptance criteria.

### 2. Surprises & False Dependencies
- **Soft Dependencies vs. Procedural Assumptions:** A key realization was that many supposed blockers are merely procedural preferences rather than hard technical dependencies. Search (`WI-05`) can be developed against mock availability stubs before the full scheduling engine (`WI-04`) is complete. Similarly, Notifications (`WI-09`) can be engineered against event contracts rather than blocking on end-to-end payment integrations.
- **The 19-Day Critical Path Floor:** The realization that eight individually modest tasks create an irreducible 19-business-day delivery floor demonstrated how sequential dependencies secretly bound project timelines regardless of team size.

### 3. Design Problems vs. Planning Fixes
- **The Circular Dependency Revelation:** The circular dependency between Provider Vetting, Admin Dashboard, and Provider Data could not be solved by backlog reordering or sprint prioritization. It was an ontological flaw: assuming provider data could only exist after approval, while approval required inspecting submitted data.
- **Agile Limits:** Agile ceremonies cannot fix broken underlying data models or circular contracts. Engineering teams must resolve the architecture first—here, introducing an explicit `PENDING_REVIEW` lifecycle state to separate submission from public activation.

### 4. Trade-offs of Actively Shortening the Critical Path
- **Node Splitting in Practice:** Decomposing Admin Tooling into `WI-02B: Admin Review Tool (Minimal)` (1d on critical path) and `WI-13: Full Admin Dashboard` (2d in parallel) eliminated the cycle and unlocked early parallel execution.
- **Managing the Coordination Cost:** Actively shortening the critical path trades sequential waiting time for interface contract coordination. This trade-off is manageable and worthwhile when shared schemas, centralized status state machines, and clear API boundaries are established upfront.
