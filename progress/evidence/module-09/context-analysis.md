# Module 09: Testing — CONTEXT Analysis & Architecture Report

## 1. Executive Summary & Context

Module 09 (Testing) in the Upsk System Design Fundamentals track focuses on shipping production systems with high confidence and verifying critical behaviors:
- **Redirect correctness** (`GET /r/:code`)
- **Authentication & authorization protection** (JWT verification, IDOR prevention via `createdBy` scoping)
- **Analytics writes** (asynchronous BullMQ queues, worker retries, idempotency)
- **Database and environment isolation** (preventing test suites from mutating or corrupting production/development data)

---

## 2. Upsk Module 09 Instructions & Requirements

### Direct Instructions (from `upsk status`)
- **Step**: `STEP 1: CONTEXT`
- **Core Principle**: Tests are how we ship with confidence.
- **Highest-risk behaviors**:
  1. Redirect correctness
  2. Auth protection
  3. Analytics writes (sync/async)
- **Why this matters in production**:
  - The most expensive bugs: auth bypass (data leaks), wrong redirects (security incidents, broken user trust), double-counted analytics (bad business decisions).
  - Real incident: A test suite pointed at a real database because one environment variable was wrong. Isolation is not optional.
- **Micro-Exercise Questions**:
  1. *If you could only write one test today, what would it be and why?*
     - The redirect correctness and authorization path (`GET /r/:code` and owner-scoped CRUD): A failure in redirects directly breaks the core business function for end-users, while an authorization bypass exposes private links and sensitive user destinations.
  2. *What’s the fastest way a test can accidentally hit a real database?*
     - Missing test environment isolation: When the test runner defaults to loading `.env` instead of `.env.test`, or when `DATABASE_URL` falls back to the default dev/production database connection string rather than an isolated test database/schema.
- **Official Upsk Hint**: `"Print which DB URL tests use."`

---

## 3. Existing Project Testing Architecture (Modules 01–08)

### Current Framework & Tooling
- **`package.json`**:
  - No `test` script defined in `"scripts"`.
  - No standard unit/integration testing framework (`jest`, `vitest`, `mocha`, `@types/jest`, `supertest`) installed in `devDependencies`.
- **Execution Mechanism**:
  - Custom standalone TypeScript scripts in `api/scripts/` executed via `npx ts-node scripts/<name>.ts`.
  - Assertion model: Custom `assertCheck(condition, label, details)` recording passes and failures, writing structured evidence logs to `progress/evidence/module-XX/`.

### Existing Test Suite Inventory
1. **Module 03 (`verify-module-03.ps1`)**:
   - HTTP CRUD operations, scheme and authority validation, HTTP 302 redirects.
2. **Module 04 (`verify-module-04.ts`) — 31 checks**:
   - JWT authentication (`401` on invalid/missing tokens).
   - Resource-level IDOR ownership enforcement (`404` on cross-owner link access/updates/deletes).
   - Route rate limits (`POST /auth/login` at 10/min, `POST /links` at 30/min, `GET /r/:code` at 120/min, `GET /links/:id/analytics` at 60/min).
   - Health check bypass (`GET /health` remains `200` after throttling).
3. **Module 05 (`verify-module-05.ts`) — 26 checks**:
   - Standardized error envelope (`VALIDATION_ERROR`, `INVALID_JSON`, `UNAUTHORIZED`, `NOT_FOUND`, `DATABASE_UNAVAILABLE`).
   - `X-Request-Id` propagation and sanitization.
   - Centralized secret and PII redaction (scrubbing tokens, passwords, IPs, connection strings).
   - Isolated broken-database drill (HTTP 503 with zero credential leaks).
4. **Module 06 (`verify-module-06.ts`) — 33 checks**:
   - Redis cache-aside hit/miss flow with bounded TTL and jitter.
   - Throttling enforcement *before* cache lookup (preventing cache-hit amplification).
   - Single-flight lookup coalescing (collapsing 20–25 concurrent cold misses to 1 DB read).
   - Invalidation on `PATCH` and `DELETE`.
   - Broken Redis connection and mid-flight drop graceful fallback to PostgreSQL.
5. **Module 07 (`verify-module-07.ts`) — 21 checks**:
   - Asynchronous BullMQ click analytics queueing (HTTP 302 decoupled from DB write latency).
   - Worker processing with UUID idempotency key and PostgreSQL unique constraint.
   - Transient database failure retry (`ECONNRESET` recovery with exponential backoff).
   - Failed and completed job retention policies.
   - Analytics endpoint with date-range filtering, IDOR protection, and 30-day retention purge.
6. **Module 08 (`verify-module-08.ts`) — 17 checks**:
   - PostgreSQL-native search with `pg_trgm` GIN indexes and tag array filtering.
   - `EXPLAIN ANALYZE` query plans on 24,100 rows confirming zero `Seq Scan`.
   - Bounded pagination (`page`, `page_size`, `total`), rejection of `principal_id` overrides.
   - Cross-owner search isolation.
7. **Module 08 Mini-Task (`verify-module-08-mini-task.ts`)**:
   - Live HTTP search with pagination metadata and safe neutralization of SQL injection input (`' OR 1=1 --`).
8. **Module 08 Break Repro (`repro-module-08-break.ts`) — 18 checks**:
   - Reproduction of `to_tsquery()` syntax crashes (SQLSTATE `42601`) vs safe parsing with `plainto_tsquery()`.

---

## 4. Current Test Coverage & Identified Gaps

| Dimension | Current Implementation Status | Identified Gap / Risk |
| :--- | :--- | :--- |
| **Test Framework** | Standalone TS runner scripts via `ts-node` | No standard Jest/Vitest test runner; no code coverage reports; no standard lifecycle hooks (`beforeEach`, `afterEach`). |
| **Unit Testing** | Inlined utility checks in scripts (redaction, regex, hashing) | No isolated unit tests for core domain services (`LinksService`, `AuthService`, `AnalyticsQueueService`) using mocks. |
| **Database Isolation** | Tests connect to `DATABASE_URL` from `.env` (`upsk_sdf`) | **Critical Risk**: Tests mutate the primary development database. No isolated test database (e.g. `upsk_sdf_test`) or isolated schema. |
| **Port & Process Management** | Scripts spawn external `node dist/main.js` on hardcoded ports | Cold-start latency and process management can cause port collisions (`EADDRINUSE`) or startup timeouts under heavy CPU load. |
| **Mocking / Virtualization** | Live integration against real Postgres & Redis instances | Inability to test complete offline scenarios or fine-grained failure injection without stopping Docker/services. |
| **Edge Cases** | High coverage on known attack vectors and happy paths | Missing automated property-based testing and parameterized regression suites across concurrent mutations. |

---

## 5. Potential Reliability & Production Risks

1. **Shared Database Contamination**:
   - If an integration test fails before its cleanup routine (`finally { deleteMany }`), leftover rows remain in `public.links` and `public.click_events`. Subsequent runs or dev operations can observe skewed counts or duplicate key collisions.
2. **Missing Test Lifecycle Isolation**:
   - In standard testing frameworks, each test case or file can run within an isolated transaction rollback or dedicated schema. The current custom runners rely on manual `deleteMany` calls with explicit owner filters.
3. **Flaky Network / Process Bootstrapping**:
   - Because verification scripts boot the full NestJS application over real TCP ports, any transient port lock or slow NestJS initialization (e.g. BullMQ Redis connect) can fail a suite.

---

## 6. Recommended Testing Strategy for Module 09

1. **Preserve All Existing Verification Runners**:
   - Keep `scripts/verify-module-04.ts` through `verify-module-08.ts` intact so existing regression proof remains 100% reproducible.
2. **Introduce Standard Test Infrastructure**:
   - Configure Jest and Supertest for NestJS.
   - Support both pure unit tests (zero external dependencies) and integration tests (`supertest(app.getHttpServer())`).
3. **Enforce Database Isolation**:
   - Explicitly define and verify test database configuration (e.g. `DATABASE_URL_TEST` or a separate `upsk_sdf_test` database).
   - Ensure test scripts print and verify their target `DATABASE_URL` to prevent accidental mutation of non-test databases.
4. **Prioritize High-Risk Core Scenarios**:
   - Unit tests: URL validation rules, tag normalization, IP hashing, error filter redaction.
   - Integration tests: HTTP 302 redirect correctness, authentication guard failure (401), IDOR isolation (404), and background queue enqueueing.

