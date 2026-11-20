# Module 02 – Step 1: CONTEXT
## Simple DAG Analysis

### 1. Parallel Execution
Tasks **B and C** can be executed concurrently in parallel once Task A completes.
- **Task B (User Registration API):** Depends only on Task A (database setup).
- **Task C (Provider Profile Page):** Depends only on Task A (database setup).
- Tasks B and C have no mutual dependencies, allowing two engineers (or parallel agents) to build them simultaneously without blocking each other.
- Task A must finish before either can start, and Task D must wait for both B and C to complete.

### 2. The Longest Chain (Critical Path Candidate)
The longest structural dependency chains are:
- Path 1: `A → B → D` (Length: 3 nodes)
- Path 2: `A → C → D` (Length: 3 nodes)

Both paths share root dependency Task A and terminal dependency Task D. Without explicit time duration estimates, both paths represent equal 3-step structural sequences. Once task durations are assigned (e.g., if Provider Profiles takes 3 days while User API takes 1 day), the path with the largest total duration becomes the true **Critical Path**.

### 3. Delay Impact
If **Task A** takes twice as long as expected:
- **Task B is delayed:** It cannot execute database migrations or generate schema clients without A.
- **Task C is delayed:** It cannot persist or query provider profile tables without A.
- **Task D is delayed:** It is blocked by both B and C.
- **Conclusion:** Because Task A is an un-bypassed root bottleneck with zero float, any delay in Task A directly delays every downstream task and shifts the entire project delivery date day-for-day.

### Core Takeaway
Dependency mapping (DAGs) reveals:
1. **Parallelization potential:** Which work streams can be decoupled to avoid unnecessary serialization.
2. **Cascading risk:** Which root dependencies have zero tolerance for delay because multiple downstream workstreams branch from them.
3. **Synchronization barriers:** Where parallel tracks must converge before integration (e.g. Task D needing both B and C).
