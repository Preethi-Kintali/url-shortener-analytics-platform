# Team Collaboration Platform — Architectural Decision Records (ADRs)

This document captures the foundational architectural decisions made across Modules 01 through 08. It preserves architectural intent so future engineers understand the trade-offs, constraints, and security invariants behind the design.

---

## ADR-01: Incremental Task-by-Task Decomposition over Monolithic Prompts
- **Date**: Module 01 & Module 02
- **Status**: Accepted
- **Context**: Monolithic prompts asking an AI agent to "build the collaboration system" produce unreviewable 1,000-line diffs, hallucinated models, and ungrounded security assumptions.
- **Decision**: Decompose the feature into a 9-task dependency tree with explicit input/output schemas and a strict 150-line per-task modification limit.
- **Consequences**:
  - *Positive*: Every unit was independently testable; security boundaries were identified upfront.
  - *Trade-off*: Requires disciplined upfront decomposition effort before writing code.

---

## ADR-02: Layered Context Engineering & Negative Constraints
- **Date**: Module 03
- **Status**: Accepted
- **Context**: Dumping entire repositories into an AI's context window causes token depletion, attention dilution, and pattern drift.
- **Decision**: Structure prompt context as a **Context Triangle**:
  1. *Architectural Brief* (reusable NestJS conventions, Prisma patterns, error envelopes).
  2. *Local Context* (only the specific controller/service being extended).
  3. *Negative Constraints* (what the AI must NOT do, e.g. no raw string throws, no optional auth).
- **Consequences**:
  - *Positive*: Model produces idiomatic, non-drifting code on first iteration.
  - *Trade-off*: Context must be curated per task rather than automated globally.

---

## ADR-03: Zero-Trust Tenant Authorization over Authentication
- **Date**: Module 04
- **Status**: Accepted
- **Context**: Insecure Direct Object References (IDOR) on `POST /teams/:teamId/invitations` allowed authenticated non-members to invite users to competitor teams.
- **Decision**: Enforce complete separation between authentication (`JwtAuthGuard` populating `req.user`) and tenant authorization. Every handler must explicitly query `(teamId, callerUserId)` and assert that `membership.role IN ('OWNER', 'ADMIN')`.
- **Consequences**:
  - *Positive*: Complete cross-tenant isolation and fail-closed security.
  - *Trade-off*: Requires an additional database query or cached token check per request.

---

## ADR-04: Heartbeat Dead-Socket Eviction and Monotonic Event Replay
- **Date**: Module 05
- **Status**: Accepted
- **Context**: Real-time activity feeds suffered from connection spirals and ghost sockets where passive event delivery was mistaken for socket liveness.
- **Decision**:
  1. Implement strict two-phase heartbeat: server issues ping frame, client must respond with pong within timeout, otherwise socket is evicted (code 4008). Downlink data transmission does NOT reset liveness.
  2. Implement monotonic sequence numbers (`sequence: 1, 2, 3...`) with staging queues to prevent out-of-order event delivery during client reconnections.
- **Consequences**:
  - *Positive*: Guaranteed monotonic replay, zero duplicate frames, clean memory sweep.
  - *Trade-off*: Slight client-side buffering complexity during active reconnection.

---

## ADR-05: Interface-First Contracts for Multi-Agent Orchestration
- **Date**: Module 06
- **Status**: Accepted
- **Context**: Three parallel AI agents building Comments, Mentions, and Audit Logging simultaneously under branch-and-merge produced physical merge conflicts and data-flow gaps.
- **Decision**: Adopt **Option A (Interface-First)**: lock down component interfaces, DTOs, and event bus payloads in `interface-contracts.js` before concurrent implementation, and isolate agents into disjoint directories.
- **Consequences**:
  - *Positive*: Zero physical Git merge conflicts; clear pub/sub boundaries.
  - *Trade-off*: Requires expanding component output contracts into system-level integration contracts to link pub/sub emitters with middleware consumers.

---

## ADR-06: Hierarchical Role RBAC & Composite Exploit Defense
- **Date**: Module 07
- **Status**: Accepted
- **Context**: An authenticated `VIEWER` could self-elevate to `ADMIN` on `PUT /teams/:id/members/:uid` because the endpoint checked only `isTeamMember` and accepted arbitrary role strings.
- **Decision**: Enforce six explicit constraints:
  1. Only `ADMIN` or `OWNER` can modify roles (`isTeamAdminOrOwner`).
  2. Users cannot modify their own roles (`uid !== caller.id`).
  3. Roles validated against strict enum whitelist (`['admin', 'member', 'viewer']`).
  4. Admins cannot promote users to `owner`.
  5. Non-owners cannot modify or demote the team `owner`.
  6. All role mutations emit structured audit events.
- **Consequences**:
  - *Positive*: Neutralizes composite privilege escalation and establishes immutable owner protections.
  - *Trade-off*: Self-service demotion is disabled; must be performed by another team administrator.

---

## ADR-07: Production-Grade CI Verification & Expand-Contract Rollback
- **Date**: Module 08
- **Status**: Accepted
- **Context**: Releasing AI-generated features without automated CI verification or backward-compatible deployment creates high-risk production incidents.
- **Decision**:
  1. Adopt **Option B (Production-Grade)**: mandate a single-signal pass/fail CI gate running linting, database migrations, and 100% of unit/integration test suites.
  2. Adopt the **Expand-and-Contract** deployment pattern for database changes: schema additions are deployed first with backward-compatible defaults, followed by code rollout, before dropping deprecated columns.
  3. Maintain a documented rollback plan with health-check circuit breakers.
- **Consequences**:
  - *Positive*: Zero-downtime releases, automated regression detection, and predictable rollback.
  - *Trade-off*: Database migrations require multi-stage deployments rather than single-step changes.
