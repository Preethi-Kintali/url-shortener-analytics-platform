# Module 03 Reflection: Context Engineering & The Information Diet

## 1. Executive Summary & Core Engineering Shift

In Module 03, I explored **Context Engineering**—the discipline of curating the minimum effective information diet an AI agent needs to produce production-grade, convention-matching code. 

Prior to this module, my mental model focused primarily on prompt instructions ("what the agent should do"). Through the design of the **Context Triangle** (Architectural, Local, and Constraint context) for the Team Collaboration feature on top of our NestJS URL Shortener & Analytics API, I realized that instructions are toothless without precise context. Without explicit grounding in our existing codebase, an agent pattern-matches against its generic training data (Express, Flask, random internet tutorials), producing code that technically runs in isolation but introduces severe architectural drift into production.

---

## 2. Core Reflection Questions (First-Person Perspective)

### Q1. How did context quality affect AI output?
Context quality directly dictated the architectural fidelity of the generated code:
- **Architectural Context Omission:** In my initial system-level draft, I listed built-in NestJS exception classes (`BadRequestException`, `NotFoundException`) in prose, but failed to include the TypeScript interface for `SafeErrorEnvelope` (`{ error: { code, message, request_id } }`) from [all-exceptions.filter.ts](../../../api/src/common/filters/all-exceptions.filter.ts).
- **Mechanism Ambiguity:** Because the prompt did not explain the NestJS exception pipeline—specifically that `AllExceptionsFilter` is registered globally as `APP_FILTER` in [app.module.ts](../../../api/src/app.module.ts) and is the sole authority responsible for serializing error JSON—the agent assumed the controller or service should format the error response body.
- **Constraint Absence:** Without an explicit negative constraint forbidding ad-hoc error JSON, the agent generated:
  ```json
  {
    "status": "error",
    "message": "Team name is required.",
    "statusCode": 400
  }
  ```
  This ad-hoc payload broke the client-facing contract. A frontend client expecting `response.data.error.message` would encounter an unhandled `TypeError: Cannot read properties of undefined (reading 'message')`. Furthermore, because the error bypassed `AllExceptionsFilter`, the `X-Request-Id` trace ID was omitted and the structured logger never emitted a `request_error` log, blinding our observability monitors.

### Q2. What changed after improving context?
Improving the context from vague guidance to explicit architectural guardrails completely eliminated convention drift:
- **Formal Interface Anchor:** In [progress/system-context.md](../../system-context.md), I added the exact `SafeErrorEnvelope` interface definition and mapped each exception class to its deterministic envelope code (`VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`).
- **Architectural Separation of Concerns:** I established the explicit rule: *Domain controllers and services must NEVER format error JSON; they must strictly throw standard NestJS `HttpException` subclasses and let `AllExceptionsFilter` serialize them.*
- **Concrete Anti-Pattern vs. Correct Exemplar:** I provided a direct code comparison showing the forbidden pattern (`res.status(400).json(...)`) next to the canonical pattern (`throw new BadRequestException(...)`).
- **Negative Constraints:** In [progress/context-packages.md](../../context-packages.md), I added Universal Constraint 6 and injected negative constraints into the prompts for Task 2 and Task 3 prohibiting manual error formatting.
- **The Result:** The resulting output matched the codebase convention with 100% precision. Services cleanly throw exceptions, controllers pass clean domain responses, and the global filter handles request tracing, sensitive text redaction, and standardized serialization.

### Q3. What will you do differently in future AI-assisted development?
For every future feature delegated to an AI agent, I will follow a rigorous 4-step Context Engineering protocol:
1. **Inspect Before Prompting:** I will never prompt an agent based on memory or assumptions. I will inspect actual codebase files to identify existing conventions, decorators (e.g. discovering `@CurrentPrincipal()` instead of hallucinating `@CurrentUser()`), and configuration pipelines.
2. **Layer Context Systematically:** I will maintain a reusable architectural context document for repository-wide standards (NestJS DI, PrismaService, snake_case DB columns, logging, error envelopes) so individual task prompts remain concise and token-efficient.
3. **Curate Local Exemplars Surgically:** For each atomic task, I will provide 2 to 4 exact file paths that demonstrate the target pattern (e.g., pairing `links.controller.ts` and `links.service.ts` as structural templates for `teams.controller.ts` and `teams.service.ts`).
4. **Enforce Negative Constraints ("Must-Nots"):** I will proactively anticipate where an LLM is likely to fall back to generic internet boilerplate and add explicit negative constraints (e.g., "Do not add new npm dependencies", "Do not format error JSON manually", "Keep diff under 150 lines").

---

## 3. Evaluation Prompt Questions

### 1. For a task you have never run before, how would you decide which files to include as context?
I use the **Dependency & Boundary Heuristic**:
1. *Upstream Interface:* The schema or contract defining the data structures (e.g., `schema.prisma`).
2. *Adjacent Exemplar:* The closest existing sibling feature implementing the same role (e.g., if writing a new CRUD controller, provide `links.controller.ts` and `links.service.ts`).
3. *Cross-Cutting Utilities/Decorators:* The exact decorators or guards used on the route (e.g., `current-principal.decorator.ts` and `jwt-auth.guard.ts`).
4. *Negative Constraint Anchor:* Any filter or middleware whose contract must not be violated (e.g., `all-exceptions.filter.ts`).
I exclude unrelated domain logic, large utility libraries, test suites, or full directory dumps.

### 2. What is the most important file in your system-level context document, and why?
[api/src/common/filters/all-exceptions.filter.ts](../../../api/src/common/filters/all-exceptions.filter.ts).
*Why:* While domain features vary wildly across links, analytics, and teams, the error envelope is the universal cross-cutting boundary across the entire application. It governs client SDK parsing, distributed tracing (`request_id`), APM structured logging, sensitive data redaction, and HTTP status code normalization. If an agent drifts on the error envelope, it creates system-wide client regressions that unit tests often fail to catch.

### 3. If someone handed you a context package with 30 files in it, what is the first thing you would do?
I would immediately **prune it down to minimum effective context (3 to 6 files)**. A 30-file context dump induces "lost in the middle" attention dilution, exhausts the prompt token budget, and introduces conflicting patterns from disparate modules. I would strip all non-essential files, identify the 2–3 canonical exemplars, extract the shared architectural invariants into a system context sheet, and discard the rest.

### 4. Describe a situation where surgical context would be better than layered context, and one where it would be worse.
- **Where Surgical is Better:** A tightly scoped, self-contained leaf bug fix (e.g. fixing a regular expression in `url.validator.ts`). Giving the agent only `url.validator.ts` and its test file provides laser-focused attention with zero noise, whereas a layered system context would waste tokens on database, authentication, and queuing rules irrelevant to pure string parsing.
- **Where Surgical is Worse:** Multi-task feature development across horizontal layers (e.g. our 9-task Team Collaboration feature). If each task only receives hand-picked local files without a shared system-level document, individual tasks will drift on cross-cutting conventions (e.g., Task 1 using camelCase DB columns, Task 2 returning custom error JSON, Task 3 using `@CurrentUser()`). Layered context guarantees cross-task architectural consistency.

---

## 4. Decision Callback: Layered Context Strategy in Retrospect

In Step 2 (DECIDE), I selected **Option B: Layered Context Strategy** over Option A (Surgical).
- **Validation of the Decision:** The layered approach saved massive overhead across Tasks 1, 2, and 3. By authoring a single reusable `system-context.md`, each individual prompt was kept under 45 lines while maintaining uniform compliance with NestJS dependency injection, Prisma snake_case mappings, `@CurrentPrincipal()` usage, and class-validator DTOs.
- **The Lesson of the BREAK Step:** The convention violation in BREAK taught me that layered context is only as good as its precision. Saying *"follow existing error patterns"* in an architectural document is insufficient. To prevent LLM drift, system context must contain **explicit interface contracts (`SafeErrorEnvelope`)**, **architectural pipeline rules (throw vs. serialize)**, **concrete anti-pattern examples**, and **negative constraints**.

---

## 5. Knowledge Check & Practical Verification

### Comprehension Questions:
1. **Core Problem Solved:** Context Engineering eliminates convention drift and pattern contamination by providing the agent with minimum effective context rather than noisy entire directories or starved one-liners.
2. **Highest-Impact Decision:** Selecting the Layered Context Strategy with explicit negative constraints, because it balances token economy with cross-cutting architectural consistency across all atomic tasks.
3. **End-to-End Proof:** Inspecting `all-exceptions.filter.ts`, `request-id.util.ts`, and `app.module.ts`, verifying that the corrected prompts strictly enforce NestJS `HttpException` throwing and `SafeErrorEnvelope` serialization without modifying a single line of production application code.

### Mini Practical Task (Step 4 Verification Proof):
- Executed convention verification auditing raw first-pass outputs against actual repository source code across 6 dimensions (naming, NestJS DI, DTO validation, error handling, Prisma mappings, and context effectiveness).
- Proof captured in [progress/convention-verification.md](../../convention-verification.md) and [progress/context-fix.md](../../context-fix.md).
- Confirmed zero application code modification via `git status` on `github-public`.

### Risk & Mitigation Forward into Module 04:
- **Risk:** Convention-consistent code can still contain subtle security vulnerabilities, IDOR flaws, authorization bypasses, or race conditions. Code that "looks right" is often the most dangerous because syntax and style lull reviewers into a false sense of security.
- **Mitigation:** In Module 04, we will transition from convention verification to adversarial code review, testing edge cases, privilege boundaries, and runtime correctness.

