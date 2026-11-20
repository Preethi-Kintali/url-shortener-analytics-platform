# Module 01 Reflection: Architectural Exploration & Trust Calibration

**Track:** AI-Augmented Engineering (Launchpad — Module 01)  
**Scenario:** Team Collaboration Platform (`team-collaboration`)  
**Delegation Strategy:** Option B — Task-by-Task (`task_by_task`)  
**Date:** November 2026  

---

## 1. Delegation Strategy Validation

In Step 2, I chose **Option B: Task-by-Task (`task_by_task`)** over Full Autopilot.

Working through the subsequent verification, failure injection (BREAK), and root-cause fix (FIX) confirmed that this choice was entirely justified:
- Because the exploration was staged incrementally, when the intentional wrong claim was presented during BREAK ("workspace is only platform files with no application"), we were able to quickly isolate the error to a single scoping check rather than untangling a web of compounded, wrong assumptions.
- Reviewing smaller batches allowed us to separate existing codebase realities (NestJS, Prisma, BullMQ) from proposed feature extensions (`Team`, `Invitation`) before any code was written or modified.
- I will maintain the Task-by-Task strategy for Module 02.

---

## 2. What the Agent Got Right (Factual & Structural Grounding)

The AI assistant excelled at extracting concrete, literal facts that exist directly in the files:
- **Module & Directory Layout:** Accurately mapped the NestJS modular architecture under `api/src/` (`auth`, `links`, `analytics`, `cache`, `common`, `health`, `prisma`, `redirect`).
- **Dependency Ingestion:** Accurately listed package dependencies from `api/package.json` (`@nestjs/common`, `@prisma/client`, `bullmq`, `ioredis`, `@nestjs/throttler`).
- **Prisma Schema Inspection:** Accurately detailed existing models (`Link`, `ClickEvent`), their database column mappings (`@map`), and index declarations.
- **Authentication Mechanics:** Correctly parsed `auth.service.ts` and `jwt-auth.guard.ts`, noting that both `sub` and `principal_id` are populated in the JWT payload and that missing tokens throw explicit `UnauthorizedException` (HTTP 401).

---

## 3. What the Agent Got Wrong & Failure Mode Analysis

The AI assistant failed in two critical ways when unconstrained:
1. **Surface Scoping Assumption (BREAK drill):**
   - *Wrong Claim:* "This starter workspace is only a platform folder with AGENTS.md, CLAUDE.md, reports, and progress/; it has no real application files to test."
   - *Failure Mode:* **Insufficient Context / Surface Scoping**. The agent looked only at the repository root and generalized from shallow metadata without checking the `api/` directory.
2. **Phantom Model Hallucination & Pattern Bias:**
   - *Hallucination:* Assuming that `Team`, `Membership`, and `Invitation` models already existed in `schema.prisma` simply because the prompt described the "Team Collaboration" scenario.
   - *Pattern Bias:* Assuming rate limiting was a distributed Redis sliding window rather than the in-memory `ThrottlerModule.forRoot()` actually implemented.
   - *Failure Mode:* **Hallucination & Architectural Bias**. The agent defaulted to textbook full-stack patterns rather than inspecting codebase specifics.

---

## 4. The Calibrated Trust Model

After completing the trust audit and verification drills, my trust model is structured as follows:

| Category | Level of Trust | Verification Approach |
|---|---|---|
| **Factual & Structural** (file exists, dependency listed, export named X) | **High (TRUST)** | Spot-check with lightweight CLI commands (`ls`, directory check, `package.json` check). |
| **Behavioral & Flow** (auth guard error codes, tenant isolation queries) | **Moderate (VERIFY)** | Verify via negative test cases, targeted code line checks, or explicit test scripts. |
| **Systemic & Distributed** (clustering, distributed locks, rate limiting) | **Low (SUSPICIOUS)** | Must verify configuration files and service registrations; never trust generic "production-ready" claims. |
| **Scenario Extensions** (proposed models, new endpoints) | **Zero (ASSUMPTION)** | Treat as non-existent until explicitly defined in schema and verified via migration. |

---

## 5. Key Surprise: Uniformity of AI Confidence

The most striking observation from Module 01 was the **uniform confidence of the AI agent**:
- The agent asserted factually true claims (e.g., "Prisma models are Link and ClickEvent") and factually false claims (e.g., "this starter workspace has no real application files") with the identical authoritative tone, clean formatting, and structured syntax.
- Confidence is not a proxy for correctness. Without active, skeptical human verification, subtle falsehoods blend seamlessly into accurate summaries.

---

## 6. Looking Ahead to Module 02 (Task Decomposition)

Carrying these lessons into Module 02 (Task Decomposition for Team Collaboration):
1. **Directory-Constrained Prompts:** I will explicitly specify file paths and target directories (`api/prisma/schema.prisma`, `api/src/teams/`) in prompts to prevent surface scoping errors.
2. **Separation of Existing vs. Proposed State:** Every prompt will explicitly distinguish between what is already implemented (`Link`, `ClickEvent`) and what is being added (`Team`, `Membership`, `Invitation`).
3. **Runnable Sanity Verification:** Every decomposed task must define a concrete, testable verification command (e.g., `pnpm run build`, `prisma validate`, or a unit test) before moving to the next task.
