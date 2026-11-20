# Module 06: Multiple Agents, One Codebase — STEP 2: DECIDE
## Decision: Parallelization Plan — Option A: Interface-First

**Course**: Upsk AI-Augmented Engineering (Practitioner Pack)  
**Module**: Module 06 — Multiple Agents, One Codebase  
**Step**: STEP 2: DECIDE — Parallelization Plan  
**Selected Strategy**: **Option A — Interface-First**  
**Stored State**: `decisions.module_06.parallelization_plan = interface_first`

---

## 1. Context & Trade-Off Analysis

When orchestrating multiple AI agents executing in parallel against a single codebase, the central challenge is coordinating shared mutable state across independent agent context windows.

### Comparison Matrix

| Dimension | Option A: Interface-First (Selected) | Option B: Branch-and-Merge (Rejected) |
|---|---|---|
| **Coordination Model** | Define data schemas, DTOs, and event signatures *before* spawning parallel agents. | Allow agents to build independently; reconcile divergent implementations at merge time. |
| **Schema Governance** | Partition models into disjoint relational tables connected by foreign keys (`teamId`). | Agents mutate shared models (e.g., both editing `model Task` in `schema.prisma`), causing migration conflicts. |
| **Upfront Investment** | High initial investment in contract design and boundary specification. | Zero upfront contract design; agents begin immediately. |
| **Integration Cost** | Low. Additive directory merges with pre-agreed API boundaries. | Catastrophic. Merge conflict resolution time exceeds implementation time savings. |
| **Primary Failure Risk** | Contract specification error: a flawed initial DTO propagates to all agents built against it. | Semantic collision: divergent database migrations, incompatible test fixtures, and broken assumptions. |
| **Mitigation Strategy** | Define **Minimum Effective Interface Contracts**: lock boundary types while leaving internal service logic flexible. | N/A: resolving divergent migrations requires manual SQL rewriting and dropped databases. |

---

## 2. Principled Justification for Option A

1. **The Shared File Hazard in TypeScript & Prisma**:
   In our NestJS / Prisma architecture, `api/prisma/schema.prisma` is the single source of truth for data models, and `api/src/app.module.ts` is the central module manifest. If Agent A (Comment Threads) and Agent B (Audit Log) execute under Option B (Branch-and-Merge):
   - Both agents alter `model Task` or `model Team`.
   - Prisma generates conflicting timestamped migration files (`YYYYMMDD_add_comments` vs `YYYYMMDD_add_audit_log`).
   - Running migrations in CI crashes because neither migration accounts for the other's DDL mutations.
   - Option A avoids this completely by locking the schema partition upfront into separate tables (`Comment`, `AuditLog`) referencing the immutable `teamId` / `taskId`.

2. **Test Fixture Compatibility**:
   Under Option B, Agent A's unit test fixtures mock the database without Agent B's audit fields. Merging B into main immediately breaks A's test suite. Under Option A, fixtures are authored against locked interface contracts, guaranteeing test suite orthogonality.

3. **Managing the Interface-First Risk**:
   The primary criticism of Option A is: *"What if the interface contract is wrong (e.g. omitting `parentId` for threaded comments)?"*
   - We address this by adopting the **Minimum Effective Interface Contract** principle: we lock down only the shared boundary primitives (entity IDs, HTTP route verbs, authentication principal resolution, and event envelope headers).
   - Domain-specific internal details (e.g. internal threading recursion or helper methods) remain encapsulated within each agent's dedicated module directory (`api/src/comments/`, `api/src/audit/`).

---

## 3. Official Decision Record

- **Choice**: **Option A — Interface-First**
- **Reasoning**:
  > I choose Option A (Interface-First) because parallel AI agents operating on shared mutable state (such as `schema.prisma` and `app.module.ts`) inevitably produce incompatible database migrations, schema collisions, and breaking test fixtures under branch-and-merge. Locking down the minimum effective interface contracts—DTO schemas, table foreign keys, and route signatures—upfront allows agents to build in parallel within disjoint directories with guaranteed clean integration.
