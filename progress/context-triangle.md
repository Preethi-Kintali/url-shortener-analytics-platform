# Module 03 CONTEXT: The Context Triangle & Information Diet

## 1. The Core Principle: The Information Diet

Context selection determines AI output quality more than prompt wording:
- **Mediocre prompt + Curated Context** $\longrightarrow$ Convention-consistent, working production code.
- **Brilliant prompt + Polluted Context** $\longrightarrow$ Confused, inconsistent, duplicate code.
- **Brilliant prompt + Zero Context** $\longrightarrow$ Syntactically valid code that invents its own libraries, naming conventions, and file structures.

### The Briefcase Mental Model
An AI agent's context window is like a briefcase packed for a 30-minute briefing with a brilliant outside consultant who knows nothing about your company. If you fill the briefcase with company menus, old HR policies, and entire directories, the consultant leaves giving generic, confused advice. If you curate the exact 4-5 relevant files, constraints, and pattern exemplars, the consultant delivers a surgically accurate solution on the first pass.

---

## 2. The Context Triangle Defined & Grounded in the URL Shortener API

Every effective prompt package balances three distinct layers:

```
                      ▲
                     / \
                    /   \
   Architectural   /     \   Local Context
   Context        /       \  (Surgical Exemplars)
  (System Rules) /_________\
            Constraint Context
            (Guardrails & "Must-Nots")
```

### Layer 1: Architectural Context ("How We Do Things Here")
- **Definition:** The macro conventions, framework choices, file organization, and cross-cutting infrastructure shared across the application.
- **Omission Risk:** If omitted, the agent guesses the architecture—creating flat Express handlers in a modular NestJS project, or inventing custom error handling.
- **Grounded in Our Project (`D:\Knack labs\api`):**
  - **Framework:** NestJS modular architecture (`api/src/app.module.ts`, `api/src/main.ts`).
  - **Persistence:** Prisma ORM connected via `PrismaService` (`api/src/prisma/prisma.service.ts`).
  - **Authentication:** Passport JWT strategy with `JwtAuthGuard` (`api/src/auth/guards/jwt-auth.guard.ts`) and `@CurrentUser()` decorator (`api/src/auth/decorators/current-user.decorator.ts`).
  - **Validation & Serialization:** Global `ValidationPipe` with `class-validator` DTOs.
  - **Database Naming:** PostgreSQL tables and columns use `snake_case` in DB via `@map("...")` / `@@map("...")` while TypeScript entities use `camelCase`.

### Layer 2: Local Context ("The Surgical Exemplars")
- **Definition:** The specific files and interface signatures directly relevant to the target task.
- **Omission Risk:** If omitted, the agent guesses function names, import paths, and DTO structures, duplicating utilities and breaking build imports.
- **Grounded in Our Project for `POST /teams`:**
  - **Controller Exemplar:** `api/src/links/links.controller.ts` (demonstrates route decorator patterns, `@UseGuards(JwtAuthGuard)`, DTO parameter injection).
  - **Service Exemplar:** `api/src/links/links.service.ts` (demonstrates `PrismaService` injection, transaction patterns, and standard NestJS exception throwing).
  - **DTO Exemplar:** `api/src/links/dto/create-link.dto.ts` (demonstrates validation decorators: `@IsString()`, `@IsNotEmpty()`, `@MaxLength()`).
  - **Schema Reference:** `api/prisma/schema.prisma` (defines exact relational models and foreign key syntax).

### Layer 3: Constraint Context ("The Guardrails & Must-Nots")
- **Definition:** Explicit negative instructions forbidding unwanted agent behaviors, package additions, or scope creep.
- **Omission Risk:** If omitted, the agent makes "helpful" assumptions: installing a new validation library, introducing mock data, or refactoring unrelated files.
- **Grounded in Our Project:**
  - **Zero New Dependencies:** Do not add third-party packages to `package.json` (e.g., use built-in Node `crypto`, not `uuid` npm package).
  - **Zero Hallucinated Guards:** Use existing `JwtAuthGuard`; do not write custom bearer token extraction.
  - **Standard HTTP Exceptions:** Throw NestJS built-ins (`BadRequestException`, `NotFoundException`, `ForbiddenException`, `ConflictException`); do not return custom `{ status: "error", error: "..." }` JSON envelopes.
  - **Diff Budget:** Keep total changed lines under 120–150 lines.

---

## 3. Micro-Exercise: Sorting Context for `POST /teams`

When preparing the briefing package for an AI agent to implement `POST /teams`, files sort into three distinct buckets:

| Bucket | Selected Files | Stated Reason for Inclusion / Exclusion |
|---|---|---|
| **Essential** *(Must Include)* | 1. `api/src/links/links.controller.ts`<br>2. `api/src/links/links.service.ts`<br>3. `api/src/links/dto/create-link.dto.ts`<br>4. `api/src/auth/guards/jwt-auth.guard.ts`<br>5. `api/src/auth/decorators/current-user.decorator.ts`<br>6. `api/prisma/schema.prisma` | **Provides the exact blueprint:** Shows how routes are declared, how auth is applied, how DTOs are validated, how Prisma transactions are executed, and defines the target database models. |
| **Helpful / Optional** *(Include if Budget Permits)* | 1. `api/src/links/dto/search-links-query.dto.ts`<br>2. `api/src/app.module.ts`<br>3. `api/package.json` | Useful to confirm how modules are registered in the root container and what validator versions are installed, but not strictly needed to write the controller and service methods. |
| **Noise** *(Do Not Include)* | 1. `api/prisma/migrations/*` (historical SQL)<br>2. `api/src/analytics/*` (BullMQ queues & workers)<br>3. `api/src/redirect/*` (redirect controller)<br>4. `.github/workflows/ci.yml`<br>5. `README.md` / `CLAUDE.md` / `.env.example` | **Context polluters:** Irrelevant queue workers, historical SQL, and CI pipeline configs consume context budget, introduce distraction, and risk the agent mimicking unrelated async patterns. |

---

## 4. Practical Implementation Rule

> **The Relevance Test:** Before attaching any file to an agent prompt, ask:
> *"Does this file directly define a pattern the agent must follow, an interface the agent must consume, or a constraint the agent must not violate?"*
> If the answer is no, leave it out of the briefcase.

