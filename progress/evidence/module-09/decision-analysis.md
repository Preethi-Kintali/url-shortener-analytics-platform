# Module 09: Testing — DECIDE Stage Architectural Analysis

## 1. Exact Official Upsk DECIDE Instructions

Directly retrieved from the active Upsk curriculum manifest (`upsk ref testing`):

```text
STEP 2: DECIDE (Unit-Heavy vs Integration-Heavy)

No code generation yet.

Tradeoff:
- Option A: unit-heavy
- Option B: integration-heavy

Probing questions:
- What failures are most expensive in production?
- Do we trust mocks?
- How expensive is spinning up DB/Redis in CI?

Decision impact on code:
- Store as decisions.module_09.test_strategy = unit_heavy | integration_heavy.
```

---

## 2. Available Decisions & Detailed Trade-Offs

### Option A: Unit-Heavy Testing Strategy
- **Characteristics**:
  - Focuses predominantly on isolated unit tests using mocks and stubs for all external boundaries (Prisma, Redis, BullMQ).
  - Fast execution time; zero external service dependencies during execution.
- **Advantages**:
  - Extremely fast test suite execution (runs in milliseconds).
  - No local or CI requirement for PostgreSQL, Redis, or BullMQ containers during test runs.
  - Granular failure pinpointing for pure business logic functions.
- **Disadvantages & Operational Risks**:
  - **The Mocking Trap**: Mocks are assumptions about external behavior. They frequently diverge from real database constraints, SQL dialect subtleties, and network errors.
  - In our architecture, the most expensive production bugs are multi-component integration boundaries:
    - IDOR vulnerabilities caused by missing `createdBy` clauses in Prisma queries (which mocks typically ignore).
    - Asynchronous BullMQ worker idempotency collisions (`UNIQUE` constraint on `idempotency_key`).
    - Redis cache invalidation races during `PATCH`/`DELETE` mutations.
    - PostgreSQL `pg_trgm` GIN index matching and `tsquery` parsing crashes.
  - Unit tests with mocks pass cleanly even when the underlying SQL or Redis command fails in production.

### Option B: Integration-Heavy Testing Strategy
- **Characteristics**:
  - Exercises complete HTTP requests and database/cache transactions end-to-end against real, dedicated test instances of PostgreSQL and Redis.
  - Verifies exact HTTP status codes, headers, response envelopes, database persistence, and queue side-effects.
- **Advantages**:
  - **High Confidence**: Directly validates the actual production runtime stack (NestJS pipes, JWT guards, Throttler, Prisma ORM, PostgreSQL indexes, Redis cache, BullMQ).
  - Catches the most expensive real-world failures: authentication bypasses, IDOR enumeration, cache stampedes, and data corruption.
  - Aligns with the project's established testing methodology (Modules 01–08 integration verification).
- **Disadvantages & Operational Risks**:
  - **Shared State & Flakiness Risk**: Integration tests interacting with real databases can leave residue data if not properly isolated, causing subsequent tests to fail due to order dependence.
  - **Execution Latency**: Slightly slower than pure in-memory unit tests (seconds vs milliseconds).
  - **Infrastructure Requirement**: Requires local/CI availability of PostgreSQL and Redis.

---

## 3. Recommended Decision with Justification

### Recommendation: **Option B — Integration-Heavy (`integration_heavy`)**

#### Architectural Justification:
1. **Critical Failure Vectors in URL Shorteners**:
   - The primary hazards identified by Upsk (auth bypass, redirect failures, double-counted analytics) exist at the boundary between application code and external infrastructure (PostgreSQL constraints, Redis cache, BullMQ queues). Mocks fail to simulate database connection drops, transaction rollbacks, unique constraint violations, or race conditions.
2. **Prior Track Calibration**:
   - The student's recorded pretest calibration in `progress/state.json` explicitly established `testing_style: "integration_heavy"`. Modules 01 through 08 have proven that integration-heavy verification against real databases and queues catches critical bugs (such as the Module 05 database connection drop, Module 06 single-flight stampede, Module 07 BullMQ retry drop, and Module 08 tsquery crash) that unit tests would have missed.
3. **Manageable Trade-off**:
   - The primary risk of Option B (shared state flakiness and danger of hitting real databases) is completely mitigated by implementing a dedicated test database (`upsk_sdf_test`) and strict pre-flight environment assertion guards.

---

## 4. Database Isolation and Safety Strategy

To eliminate the danger highlighted in the CONTEXT micro-exercise (*"A test suite pointed at a real database because one env var was wrong"*):

1. **Dedicated Test Database (`upsk_sdf_test`)**:
   - Tests will never run against `upsk_sdf` (the default dev database).
   - A dedicated database `upsk_sdf_test` will be provisioned once:
     ```sql
     CREATE DATABASE upsk_sdf_test;
     ```
2. **Strict Test Environment Guard**:
   - Every test runner and test configuration will enforce a mandatory pre-flight validation check before issuing any query:
     ```ts
     const dbUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || '';
     if (!dbUrl.includes('_test') && !dbUrl.includes('test')) {
       throw new Error(
         `FATAL SAFETY VIOLATION: Test suite attempted to run against non-test database: ${dbUrl}. Refusing execution!`
       );
     }
     ```
3. **Explicit Database URL Logging (Per Upsk Hint)**:
   - The test runner will log the sanitized test database URL on startup so operators can immediately verify isolation:
     `[TEST-SETUP] Target Test Database: postgresql://postgres:***@localhost:5432/upsk_sdf_test?schema=public`
4. **Deterministic Per-Test Lifecycle**:
   - Schema migrations will be applied to `upsk_sdf_test` via `prisma migrate deploy`.
   - Seed data will use isolated test fixtures, and cleanup routines will run in `beforeAll`/`afterAll` hooks to maintain a clean state between test runs.

---

## 5. Proposed Testing Architecture

### Acceptance Criteria Test Suite (Mandatory 6 Tests from Upsk Ticket):
1. **Create Link Test**:
   - `POST /links` with valid URL and tags.
   - Asserts HTTP 201 Created, normalized tag persistence, and returned link payload.
2. **Redirect Correctness Test**:
   - `GET /r/:code` (matching Module 03 `prefix_r` decision).
   - Asserts HTTP 302 Found and exact `Location` header pointing to destination URL.
3. **Authentication Protection Test**:
   - `POST /links` or `GET /links` without Authorization header.
   - Asserts HTTP 401 Unauthorized with standardized error envelope.
4. **Authorization / IDOR Regression Test**:
   - Principal A creates a link.
   - Principal B attempts to `GET /links/:id`, `PATCH /links/:id`, and `DELETE /links/:id` using Principal A's link ID.
   - Asserts HTTP 404 Not Found (matching Module 04 `not_owner_status: 404` decision) and zero data leakage.
5. **Retention Enforcement Test**:
   - Creates click events with timestamp outside the retention window (e.g. >30 days or using retention override).
   - Runs the purge mechanism/filter and asserts expired analytics records are not returned.
6. **URL Validation Regression Test**:
   - Submits known malicious/bypass URLs (e.g. `https://good.com@evil.example.com`, javascript schemes, or unencoded bypasses).
   - Asserts HTTP 400 Bad Request (`VALIDATION_ERROR`) and verifies the record is never stored in the database.

---

## 6. Expected Files and Changes for the BUILD Stage

1. **`api/package.json`**:
   - Add `"test": "..."` script to enable standard one-command execution (`npm test`).
2. **Dedicated Test Database Setup**:
   - Provision `upsk_sdf_test` on PostgreSQL instance.
   - Run Prisma migrations against `upsk_sdf_test`.
3. **Test Suite Implementation**:
   - Create the comprehensive integration test suite fulfilling all 6 acceptance criteria with strict test database assertion guards.
4. **Verification Script**:
   - Add `api/scripts/verify-module-09.ts` to execute and record evidence under `progress/evidence/module-09/` while maintaining zero regressions across Modules 01–08.

