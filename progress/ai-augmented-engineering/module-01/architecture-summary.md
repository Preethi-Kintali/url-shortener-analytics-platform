# Verified Architecture Summary: URL Shortener & Analytics Platform

**Track:** AI-Augmented Engineering (Launchpad — Module 01)  
**Verification Method:** Empirical Codebase Audit with Source Line References  
**Status:** Audited & Verified  
**Date:** November 2026  

---

## 1. Top-Level Directory & Module Structure

The project is structured as a layered, modular NestJS application:

| Path | Purpose | Key Files & Line References |
|---|---|---|
| `api/src/app.module.ts` | Root application module; orchestrates dependency injection, throttler, and exception filters | Lines 1–45: imports `LoggingModule`, `CacheModule`, `HealthModule`, `PrismaModule`, `AuthModule`, `LinksModule` |
| `api/src/worker.module.ts` | Dedicated background worker module; isolates queue processing from HTTP server | Lines 1–30: imports `LoggingModule`, `PrismaModule`, `AnalyticsModule` |
| `api/src/main.ts` | HTTP API bootstrap entry point; binds to `0.0.0.0` and dynamic `PORT` | Line 22: `app.enableShutdownHooks()`; Line 25: `await app.listen(env.port, '0.0.0.0')` |
| `api/src/worker.ts` | Queue worker process entry point; intercepts `SIGTERM`/`SIGINT` for clean queue draining | Lines 1–50: boots `WorkerModule` and handles signals |
| `api/src/auth/` | Stateless JWT authentication, credential hashing, and route guards | `auth.controller.ts`, `auth.service.ts`, `auth.types.ts`, `jwt-auth.guard.ts` |
| `api/src/links/` | Multi-tenant link lifecycle, validation, owner-scoped queries, and search | `links.controller.ts`, `links.service.ts`, DTOs, and validators |
| `api/src/redirect/` | High-frequency public redirect endpoint with cache-aside lookup | `redirect.controller.ts` (Lines 1–71) |
| `api/src/analytics/` | BullMQ click event queue producer, background worker consumer, IP anonymization | `analytics-queue.service.ts`, `analytics-worker.service.ts`, `ip-hash.util.ts` |
| `api/src/cache/` | Redis cache-aside service with command timeouts and error cooldown | `redis-cache.service.ts` (Lines 1–352) |
| `api/src/health/` | Decoupled orchestration probes (`/health` vs `/ready`) | `health.controller.ts` (Lines 1–80) |
| `api/src/common/` | Structured JSON logger, global exception filter, request ID middleware | `all-exceptions.filter.ts`, `structured-logger.service.ts`, `request-id.middleware.ts` |
| `api/prisma/` | Relational schema definition and versioned SQL migration history | `schema.prisma` (Lines 1–39), `migrations/` |
| `api/scripts/` | Automated test suites and failure reproduction drills | `verify-module-09.ts`, `verify-module-10.ts`, `drill-graceful-shutdown.ts` |

---

## 2. Verified Data Models & Relationships (`api/prisma/schema.prisma`)

The database schema strictly defines **two** operational models:

```prisma
model Link {
  id        String   @id @default(uuid())
  code      String   @unique
  longUrl   String   @map("long_url")
  tags      String[] @default([])
  createdAt DateTime @default(now()) @map("created_at")
  createdBy String   @map("created_by")

  clicks ClickEvent[]

  @@index([createdBy])
  @@index([createdBy, createdAt(sort: Desc)], map: "links_created_by_created_at_idx")
  @@map("links")
}

model ClickEvent {
  id             String   @id @default(uuid())
  idempotencyKey String   @unique @map("idempotency_key")
  linkId         String   @map("link_id")
  clickedAt      DateTime @default(now()) @map("clicked_at")
  userAgent      String   @map("user_agent")
  referrer       String
  ipHash         String   @map("ip_hash")

  link Link @relation(fields: [linkId], references: [id], onDelete: Cascade)

  @@index([linkId, clickedAt])
  @@map("click_events")
}
```

- **Relationships:** One-to-many relationship from `Link` to `ClickEvent` with cascade deletion (`onDelete: Cascade` at line 34).
- **Idempotency & Deduplication:** `ClickEvent.idempotencyKey` enforces unique delivery via a PostgreSQL unique constraint (line 27), safely handled via Prisma `P2002` error catching.
- **Important Distinction:** There are currently **NO** `Team`, `Membership`, `Invitation`, or `AuditLog` models in `schema.prisma`. Those are proposed extensions for the new Team Collaboration scenario.

---

## 3. Verified API Routes & Controllers

| Route | HTTP Method | Auth Required | Controller & Line | Functionality |
|---|---|---|---|---|
| `/health` | `GET` | No | `health.controller.ts:20` | Immediate in-memory liveness probe; returns `HTTP 200 { ok: true }` |
| `/ready` | `GET` | No | `health.controller.ts:32` | Dependency readiness probe; queries PostgreSQL `SELECT 1` & Redis `PING` |
| `/health/ready` | `GET` | No | `health.controller.ts:60` | Orchestrator alias for `/ready` |
| `/auth/login` | `POST` | No | `auth.controller.ts:11` | Authenticates principal; returns 15-minute Bearer JWT |
| `/r/:code` | `GET` | No | `redirect.controller.ts:35` | Resolves short code to destination; returns `HTTP 302 Found`; non-blocking BullMQ enqueue |
| `/links` | `POST` | Yes (`Bearer`) | `links.controller.ts:33` | Creates link scoped to authenticated principal; returns `HTTP 201 Created` |
| `/links` | `GET` | Yes (`Bearer`) | `links.controller.ts:43` | Lists links owned by principal with pagination (`page`, `limit`) |
| `/links/search` | `GET` | Yes (`Bearer`) | `links.controller.ts:56` | Trigram substring and tag search scoped to principal |
| `/links/:id` | `GET` | Yes (`Bearer`) | `links.controller.ts:74` | Fetches single link by ID; returns `HTTP 404` if unowned |
| `/links/:id` | `PATCH` | Yes (`Bearer`) | `links.controller.ts:82` | Updates link destination/tags; invalidates Redis cache |
| `/links/:id` | `DELETE` | Yes (`Bearer`) | `links.controller.ts:91` | Deletes link; invalidates Redis cache |
| `/links/:id/analytics` | `GET` | Yes (`Bearer`) | `links.controller.ts:64` | Returns aggregate click counts and analytics time series for owned link |

---

## 4. Authentication & Security Architecture

1. **JWT Structure & Claims:**
   - Interface: [api/src/auth/auth.types.ts](api/src/auth/auth.types.ts#L1-L7) defines `JwtPayload`.
   - Signing Implementation: [api/src/auth/auth.service.ts](api/src/auth/auth.service.ts#L71-L75):
     ```typescript
     const payload: JwtPayload = {
       sub: user.principal_id,
       principal_id: user.principal_id,
       email: user.email,
     };
     ```
   - **Verification:** Both `sub` and `principal_id` are explicitly populated with the principal's identifier. Token validity is 900 seconds (`JWT_TTL_SECONDS = 900`).
2. **Guards & Perimeter Enforcement:**
   - `JwtAuthGuard` ([api/src/auth/guards/jwt-auth.guard.ts](api/src/auth/guards/jwt-auth.guard.ts#L10-L28)) validates the `Authorization: Bearer <token>` header on every protected route.
3. **Owner-Scoped Data Access (IDOR Prevention):**
   - Every single link read, update, search, and delete query in [api/src/links/links.service.ts](api/src/links/links.service.ts) binds the verified principal ID:
     - `findAll`: Line 122 `where: { createdBy: ownerId }`
     - `search`: Line 161 `andClauses: [{ createdBy: ownerId }]`
     - `findById`: Line 217 `where: { id, createdBy: ownerId }`
     - `update`: Line 237 `where: { id, createdBy: ownerId }`
     - `remove`: Line 257 `where: { id, createdBy: ownerId }`
   - If a user requests a record owned by another principal, `findById` throws `NotFoundException` (404), preventing resource enumeration.

---

## 5. Caching & Queue Integration

1. **Redis Cache-Aside:**
   - Implemented in [api/src/cache/redis-cache.service.ts](api/src/cache/redis-cache.service.ts).
   - Keys: `redirect:v1:${code}`.
   - Timeouts: 500ms command timeout with immediate fallback to PostgreSQL on cache miss or timeout.
   - Subtractive TTL Jitter: [api/src/links/links.service.ts](api/src/links/links.service.ts#L430-L435) applies a 300s base TTL with 0–10% subtractive jitter (`Math.max(1, baseTtl - jitterOffset)`), producing effective expiration between 270s and 300s.
2. **BullMQ Asynchronous Analytics Queue:**
   - Implemented in [api/src/analytics/analytics-queue.service.ts](api/src/analytics/analytics-queue.service.ts).
   - Producer timeout: 250ms fail-open guard (`QUEUE_ENQUEUE_TIMEOUT_MS = 250`).
   - Worker processing: [api/src/analytics/analytics-worker.service.ts](api/src/analytics/analytics-worker.service.ts) hashes IP addresses using keyed HMAC-SHA256 and inserts clicks idempotently.

---

## 6. Database Migration Lifecycle

- **Development (`prisma migrate dev`):** Used locally to generate new versioned migration files in `api/prisma/migrations/` when `schema.prisma` is modified.
- **Production / Deployment (`prisma migrate deploy`):** Used during deployment and CI (`api/package.json` line 12: `"migrate": "prisma migrate deploy"`). Executes pending compiled migration SQL files deterministically without regenerating schemas or prompting for input.

---

## 7. Proposed Team Collaboration Extensions (Not Yet Implemented)

The following capabilities are **planned extensions** for the Team Collaboration scenario and are not currently present in the codebase:
1. `Team`, `Membership`, `Invitation`, and `AuditLog` models in `api/prisma/schema.prisma`.
2. Dedicated `TeamsModule`, `TeamsController`, and `TeamsService`.
3. RBAC authorization guard (e.g. `RolesGuard`) checking workspace-level permissions (`Owner`, `Admin`, `Member`, `Viewer`).
4. Replay-safe invitation token hashing and expiration verification logic.
5. Audit log event dispatch for team member mutations.
