# Safety Interlude Reflection: The Therac-25 — When Humans Stopped Checking

**Student:** Engineering Lead  
**Skill:** AI-Augmented Engineering (`ai-augmented-engineering`)  
**Context:** Delivered between Module 02 (Prompt Decomposition) and Module 03 (Context Engineering)  

---

## 1. What Is My Equivalent of the `READY` Indicator?

In my AI-augmented development workflow, the `READY` indicator is the green checkmark: the TypeScript compiler (`tsc`) exiting with code 0, unit tests passing in the local terminal, and the GitHub Actions CI pipeline turning green.

However, just as the Therac-25 console displayed `READY` while the beam spreader was lethally out of position, green software status indicators frequently mask severe underlying flaws.

### Lessons from Actual Project Debugging:
My recent CI debugging experience on the **URL Shortener & Analytics Platform** demonstrated how deceptive green checks can be:

1. **False Isolation & Latent Configuration Bugs (P1003):**
   In `api/scripts/verify-module-09.ts`, the test suite printed `[PASS] Database safety pre-flight: Target database is explicitly upsk_sdf_test`. The terminal looked healthy. Yet seconds later, the runner crashed with `PrismaClientInitializationError: Database upsk_sdf does not exist (P1003)`. The test runner had passed isolation checks while secretly initializing a second `devPrisma` client hardcoded to the local development database `upsk_sdf`—a database that did not exist in the isolated GitHub Actions runner. The pre-flight indicator was green, but the runtime reality was broken.

2. **Artifact Lifecycle & Step Ordering (`Cannot find module`):**
   In GitHub Actions, our integration test step was triggered before the production compilation step (`pnpm run build`). The workflow configuration passed YAML syntax checks and linting, but the moment the test spawned the API process, it aborted immediately with `Error: Cannot find module 'api/dist/main.js'`. A green CI configuration file is meaningless until the dependency and artifact graph is strictly ordered.

3. **Tooling Version Incompatibilities:**
   Locally, our `api/pnpm-workspace.yaml` utilized modern features like `allowBuilds`. Our local environment compiled cleanly. In CI, however, the runner was pinned to pnpm 9, causing `pnpm install` to abort with `ERROR packages field missing or empty`. Code that compiles locally can fail catastrophically in production or CI environments due to subtle runtime differences.

### Hidden Runtime & Security Blind Spots Behind Green Builds:
When an AI agent writes code and the compiler passes, I must recognize what the compiler is **not** checking:
- **IDOR (Insecure Direct Object References):** An endpoint can compile cleanly with zero TypeScript errors while completely omitting tenant ownership filtering (`where: { id, createdBy: userId }`), exposing private records to any authenticated caller.
- **Missing Authorization & Privilege Escalation:** An endpoint can return HTTP 200 in a unit test because the test mock bypassed the `TeamRoleGuard` or `@Roles(ADMIN)` decorator.
- **Concurrency & Race Conditions:** Two concurrent requests claiming the same invitation token or updating team membership can pass unit tests, yet trigger race conditions in production if not protected by database-level locks or serialized transactions (`prisma.$transaction`).
- **Tenant Data Bleed:** Without explicit tenant isolation tests against real relational schemas, multi-tenant queries can accidentally leak cross-team links or analytics data.

---

## 2. Where Are My "Hardware Interlocks"?

The fatal design decision of the Therac-25 was removing independent mechanical interlocks and trusting software self-checks alone. In an AI-augmented engineering process, if I accept AI code simply because it looks plausible and compiles, I have removed my interlocks.

My workflow enforces six independent, non-negotiable "Hardware Interlocks" that operate outside the AI agent's self-assessment:

1. **Human Architectural & Code Review:**
   I never treat AI output as correct by default. I inspect every diff line-by-line, verify that no unauthorized models or dependencies were introduced, and ensure the code adheres strictly to the codebase's existing architectural patterns.

2. **Runtime & DTO Boundary Validation:**
   I do not rely on TypeScript types alone at runtime. In NestJS, I mandate class-validator DTOs with `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`. If an AI agent attempts to pass unexpected fields or parameter injections, the framework rejects the payload at the HTTP perimeter with HTTP 400.

3. **Security & Boundary Test Assertions:**
   I mandate automated assertions that specifically test negative security paths: verifying HTTP 401 for missing/invalid JWT tokens, HTTP 403 for unauthorized role access or foreign tenant data, HTTP 404 for missing resources, and HTTP 409/410 for expired/reused invitation tokens.

4. **Integration Testing Against Real Service Containers:**
   I do not rely exclusively on in-memory mocks. My interlock is running integration tests against actual Docker containers—PostgreSQL 16 on port 5432 and Redis 7 on port 6379—with explicit database isolation (`upsk_sdf_test`, Redis DB 1) to verify actual SQL transactions, foreign key cascades, and connection pools.

5. **Deterministic CI/CD Quality Gates:**
   Automated pipelines running on immutable runners (GitHub Actions) that enforce lockfile determinism (`pnpm install --frozen-lockfile`), clean compilation (`pnpm run build`), migration deployment (`prisma migrate deploy`), and the full integration suite. If any step fails, the build halts.

6. **Transactional Atomicity & Versioned Rollback:**
   State-changing database mutations are bound inside atomic transactions (`prisma.$transaction`) so that partial failures roll back cleanly. All deployments and migrations are version-controlled via immutable Git commits and Prisma migration histories, ensuring rapid, reliable rollback mechanisms if an anomaly escapes to production.

---

## 3. Summary Commitment

The Therac-25 disaster taught the software engineering profession that **trusting a machine's self-reported readiness is negligent**. In AI-augmented engineering, the AI is a high-speed generator, but the human engineer remains the sole accountable guarantor of correctness, safety, and security. My independent verification gates are the interlocks that keep the system safe.

