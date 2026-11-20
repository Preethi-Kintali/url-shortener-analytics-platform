# Module 05 Step 1: Refine vs. Restart (Iteration Patterns)

## 1. Executive Summary & The Iteration Problem

In AI-augmented engineering, the most common trap is not writing a bad initial prompt—it is **iterating five or six times on a fundamentally flawed output**, layering patch on top of patch, until the resulting code is more brittle, complex, and unmaintainable than the first draft. This pathological dynamic is known as a **Quality Spiral**.

Module 05 introduces the core engineering discipline of **Iteration Patterns**: developing the judgment to distinguish between issues that warrant targeted refinement versus structural flaws that mandate an immediate restart.

```text
+--------------------------------------------------------------------------+
|                        THE ITERATION DECISION GATE                       |
+--------------------------------------------------------------------------+
|  AI Output Produced                                                      |
|         │                                                                |
|         ▼                                                                |
|  Does fixing the issue invalidate or require rethinking other parts?    |
|         │                                                                |
|         ├─── NO  ──> SURFACE ISSUE    ──> REFINE (Targeted Follow-up)    |
|         │                                                                |
|         └─── YES ──> STRUCTURAL ISSUE ──> RESTART (Fresh Prompt / Spec)  |
+--------------------------------------------------------------------------+
```

---

## 2. Surface vs. Structural Problems: The Core Distinction

The fundamental judgment call when inspecting AI output is separating problems with the **expression of the solution** from problems with the **approach itself**.

### The Definitive Diagnostic Test:
> **"If you fix this issue, does the rest of the output stay valid?"**
> - **YES:** It is a **Surface Issue**. The architecture is sound; the execution merely needs polish. Refinement will converge quickly.
> - **NO:** It is a **Structural Issue**. The solution is aimed at the wrong target. Refinement will cause cascading breakage and prompt spirals.

### Comparative Taxonomy

| Dimension | Surface Problem (Refine) | Structural Problem (Restart) |
| :--- | :--- | :--- |
| **Definition** | Flaws in formatting, naming, local syntax, or missing local error handling. | Flaws in architecture, data flow, transport protocols, or state persistence. |
| **Impact of Fix** | Localized. Fixing line 12 does not invalidate lines 13–200. | Systemic. Fixing the issue requires rewriting or throwing away adjacent modules. |
| **Codebase Example: Naming** | Variable named `ws` instead of `websocketConnection`. | Storing live socket handles in global arrays across distributed server instances. |
| **Codebase Example: Transport** | Missing JSDoc comments or status code 200 instead of 201. | Using HTTP polling instead of WebSocket / SSE for real-time events. |
| **Codebase Example: Storage** | Missing index hint or column alias in Prisma query. | Storing activity events in ephemeral process memory instead of durable DB/queues. |
| **Codebase Example: Boundaries**| Missing `@IsEmail()` validator decorator on a DTO field. | Pushing events directly from DB triggers rather than the domain service layer. |
| **Optimal Response** | Targeted follow-up prompt specifying the single correction. | Discard output, purge conversation context, and restart with a revised architecture prompt. |

---

## 3. The Sunk Cost Trap & Context Pollution

### The Sunk Cost Trap
Engineers often spend 10–15 minutes crafting a detailed prompt with context, constraints, and schemas. When the model returns 200 lines of code that look 70% complete, the natural psychological bias is to believe that the code is "almost there" and that discarding it is wasteful.

This instinct is a fallacy. When the underlying architecture is flawed, every incremental fix builds on quicksand:
1. You fix a variable naming convention, which exposes an unhandled state race condition.
2. You prompt to patch the state race condition, which breaks the event dispatcher.
3. You prompt to fix the event dispatcher, which renders your initial naming fix obsolete.
4. Each correction interacts with the structural flaw to generate compound defects.

### The Mechanical Reality of Context Pollution
Quality degradation over multiple iterations is not an accident—it is a mathematical consequence of large language model attention mechanisms:

```text
Iteration 1: [Original Prompt + Architecture Spec]                  --> Clean Output
Iteration 2: [Prompt + Output 1 + Correction 1]                     --> Coherent Polish
Iteration 3: [Prompt + Out 1 + Corr 1 + Out 2 + Corr 2]             --> Minor Degradation
Iteration 4: [Prompt + Out 1 + Corr 1 + Out 2 + Corr 2 + Out 3...]  --> Competing Directives
Iteration 5: [1500+ tokens of obsolete code & conflicting patches]  --> Context Pollution / Spiral
```

By iteration four or five:
- The context window contains hundreds of lines of conflicting code that was previously rejected.
- Earlier corrections conflict with newer requirements.
- The model spends its attention budget trying to synthesize a compromise between everything ever mentioned, resulting in degraded, hallucinated, and schizophrenic code.
- **Fresh conversations produce dramatically cleaner code than polluted multi-turn threads.**

---

## 4. The Two-Iteration Rule

To protect velocity and prevent context pollution, professional AI-augmented engineering mandates the **Two-Iteration Rule**:

> **The Rule:** If quality is not converging after **two** refinement attempts, immediately discard the thread and restart with a different architectural approach.

### Why Exactly Two Iterations?
1. **Turn 1 (The Baseline):** The agent generates the initial implementation from your initial task prompt.
2. **Turn 2 (Refinement 1):** You review the output and provide targeted feedback on surface details (e.g., naming, missing try/catch, edge-case branch). The agent applies the polish.
3. **Turn 3 (Refinement 2):** You verify whether the code converged. If minor polish remains, you finalize it. If new bugs, architectural friction, or conceptual regressions emerge, the foundation is broken.
4. **The Pivot:** If the code has not converged by Turn 3, **do not attempt a third follow-up**. Take what you learned from the failed attempt, revise your architectural context, and start a fresh conversation.

---

## 5. Official Micro-Exercise: WebSocket Activity Feed Analysis

### The Scenario
**Task:** *"Implement a WebSocket-based activity feed that pushes team events to connected clients."*
Two independent AI agents produced the following outputs:

---

### Output A: 70% Complete (Clean Surface, Structural Failure)
- **Implementation Details:**
  - Solid connection handling and cleanly written WebSocket server.
  - Event delivery is implemented via a direct PostgreSQL database trigger: every `INSERT` on `activity_events` executes `pg_notify()`, which the Node.js process listens for and broadcasts to all open sockets.
  - Payloads are raw database row dumps (`SELECT *`).
  - Zero authorization or team-based channel isolation: any connected user receives raw row events from all teams.
  - Renaming or migrating a database column immediately breaks client consumers.
- **Evaluation:**
  - *Surface Quality:* **4 / 5** (Idiomatic TypeScript, clean async/await, proper error logging).
  - *Structural Quality:* **2 / 5** (Tight database coupling, data leakage, lack of tenancy isolation, brittle contract).

---

### Output B: 40% Complete (Incomplete Surface, Structurally Sound)
- **Implementation Details:**
  - Implements an event bus utilizing a decoupled Publish/Subscribe (Pub/Sub) pattern.
  - Events are published from the domain service layer with strongly typed DTO payloads (`TeamEvent<T>`).
  - Architectural support for team-scoped channels (`teams/:teamId`), ensuring tenant isolation.
  - WebSocket transport implementation is incomplete: connection handshake contains minor bugs, reconnection logic is missing, and the broadcast function contains `// TODO: implement broadcast` stubs.
- **Evaluation:**
  - *Surface Quality:* **2 / 5** (Incomplete code, placeholder comments, missing edge cases).
  - *Structural Quality:* **4 / 5** (Correct boundaries, decoupled persistence from delivery, tenant-isolated channels).

---

### The Decision & Comparative Analysis

| Dimension | Output A | Output B |
| :--- | :--- | :--- |
| **Action** | **RESTART (Discard)** | **REFINE (Iterate)** |
| **Why?** | The flaw is **structural**. Direct database trigger coupling (`pg_notify`) cannot be "patched" with a quick prompt. Fixing tenant isolation and decoupling transport requires discarding the entire delivery pipeline. Continuing in this thread will trigger context pollution. | The flaw is **surface-level**. The architecture (Pub/Sub event bus, service-layer dispatch, team-scoped channels) is sound. Filling in method stubs and adding reconnection logic are independent, non-breaking tasks. |
| **Refinement Path** | N/A — Attempting to prompt: *"Don't use DB triggers, use a service event bus"* will cause the model to generate a messy hybrid that mixes triggers with pub/sub. | Targeted follow-up prompt: *"In the WebSocket gateway, implement the `broadcastToTeam` stub using the existing `EventBus` channel subscriptions and add a basic exponential backoff reconnection handler."* |
| **Sunk Cost Trap Risk** | High. Output A runs and looks complete, tempting developers to keep it despite its fatal lack of tenant security. | Low. Output B looks incomplete, requiring engineering discipline to recognize that good architecture with stubs is vastly superior to broken architecture that compiles. |

---

## 6. Grounding in the URL Shortener & Analytics API

Applying the Refine vs. Restart framework to our actual codebase demonstrates why this distinction is vital:

### 1. Analytics Click Stream Processing (`api/src/analytics/`)
- **Structural Failure Scenario (Restart Required):** If an agent implements click analytics by appending events directly to an in-memory array (`const clicks = []`) or attaching synchronous HTTP webhooks inside the redirect controller, this is an architectural failure. Under high redirect traffic (1,000 req/sec), in-memory arrays cause memory leaks on restart, while synchronous webhooks destroy redirect latency. No amount of follow-up prompting can fix this; the task must be restarted with an architectural prompt mandating **BullMQ + Redis asynchronous job queues**.
- **Surface Failure Scenario (Refine Permitted):** In our current implementation ([analytics.service.ts](../../../api/src/analytics/analytics.service.ts)), the BullMQ queue and worker architecture are properly decoupled. If an agent forgets to log `ip_hash` redactions or uses `clickTime` instead of `clickedAt`, these are isolated surface issues that can be polished in a single prompt.

### 2. Team Collaboration Authorization (`api/src/teams/`)
- **Structural Failure (Restart):** In Module 04, the AI baseline wrote an inline Express route mixing raw SQL template literals with direct DB insertions and zero authorization checks. Attempting to "patch" this god function in-place produced regression spirals.
- **Sound Architecture (Refine):** When we restarted with a clean NestJS component architecture ([invitations.service.ts](../../evidence/module-04/invitations.service.ts)), the structure (service injection, Prisma client, DTO validation, `@UseGuards(JwtAuthGuard)`) was solid. Adding the composite key authorization query (`teamMember.findUnique`) was a clean, localized refinement that passed 22/22 assertions immediately.

---

## 7. Protocol Commitment for Module 05

1. **Before prompting a fix:** Run the diagnostic test: *"Does fixing this invalidate adjacent code?"*
2. **Strict Two-Iteration Cap:** If a feature does not converge after two follow-up prompts, discard the branch, clear context, and rewrite the prompt using a new architectural strategy.
3. **Never Sunk-Cost Bad Architecture:** Value structural soundness over superficial completeness.
