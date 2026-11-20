# Module 02 Reflection: Prompt Decomposition & Interface Contracts

## 1. Decomposition Approach & Planning Stance
- **Chosen Stance:** Top-Down Decomposition (Option A).
- **Architectural Rationale:**
  Team collaboration introduces multi-layered dependencies across schema models, role-based authorization, token lifecycles, and tenant isolation. Planning top-down allowed us to visualize the full 9-task architecture and trace the 5-step critical path before prompting any agent.
- **Key Insight on Top-Down Fragility:**
  While top-down planning establishes macro visibility, it is vulnerable to implicit assumptions. In our BREAK scenario, Task 1 and Task 2 were planned independently, but without a locked interface contract, Task 2 assumed a `team_members` join table that Task 1 had not yet created. Top-down planning only succeeds when dependency arrows represent **contractual boundaries**, not just order of execution.

---

## 2. Task Sizing & The Atomic Task Principle
- **Task Count:** 9 atomic tasks (exceeding the 8+ ticket requirement).
- **Line Limit Compliance:** Every task was constrained to $\le 150$ lines of change (averaging 50–125 lines).
- **The Two-Sentence Rule:**
  Each task's expected output was describable in two sentences, ensuring that acceptance criteria were testable from the outside (e.g., HTTP status codes 201/400/401/403/409/410, curl invocations, Prisma migration exit codes) without inspecting internal implementation details.

---

## 3. Interface Contracts as the Core Engineering Deliverable
Decomposition is not merely slicing a feature into smaller pieces; it is defining the **connection points** between those pieces.
- **Contract 1 (Data Tier):** Pinned the exact Prisma schema for `Team`, `TeamMember`, and `TeamRole`.
- **Contract 2 (Authorization):** Pinned the Express request context (`req.teamMember`), `@Roles()` decorator, and `TeamRoleGuard`.
- **Contract 3 (Security & Tokens):** Pinned the invitation token contract (SHA-256 hash in DB, raw hex in email link, 7-day expiration, and atomic `prisma.$transaction` state transition).

---

## 4. The Critical Path & Riskiest Task
- **Critical Path:**
  $$\text{Task 1} \longrightarrow \text{Task 2} \longrightarrow \text{Task 4} \longrightarrow \text{Task 6} \longrightarrow \text{Task 7}$$
  *Sequence Length: 5 steps.* This chain defines the minimal delivery horizon for team onboarding.
- **Riskiest Task:**
  **Task 7 (Team Invitation Acceptance Endpoint):**
  This task manages concurrent state transitions and cross-cutting security boundaries. Wrapping the verification, status update, and member creation in an atomic database transaction prevents token reuse, race conditions, and privilege leaks.

---

## 5. Forward Trajectory into Module 03 (Context Engineering)
Having mastered task decomposition and interface contracts, the next risk is **Context Engineering**:
- A well-decomposed task will still fail or generate out-of-convention code if the prompt feeds the AI agent irrelevant files or leaves out essential project patterns.
- Module 03 will focus on curating the precise Architectural, Local, and Constraint context (the Context Triangle) to guide AI agents with surgical accuracy.

