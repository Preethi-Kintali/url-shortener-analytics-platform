# Upsk Module 09: Testing — FIX Step Report

**Date**: 2026-11-13  
**Project**: Upsk System Design Fundamentals — Operator Pack  
**Module**: Module 09 — Testing  
**Current Step**: STEP 6: FIX  
**Workspace**: `D:\Knack labs`  
**API Root**: `D:\Knack labs\api`  
**Evidence Files**:
- Determinism Proof: [`determinism-proof.txt`](file:///D:/Knack%20labs/progress/evidence/module-09/determinism-proof.txt)
- Integration Suite: [`integration-tests.txt`](file:///D:/Knack%20labs/progress/evidence/module-09/integration-tests.txt)
- BREAK Reproduction: [`test-break-repro.txt`](file:///D:/Knack%20labs/progress/evidence/module-09/test-break-repro.txt)

---

## 1. Official FIX Requirements

From Upsk CLI instruction:
> **STEP 6: FIX**
> - Student must:
>   - Identify why the test is unreliable
>   - Isolate state
>   - Prove determinism (run test multiple times)
> - Hint: *Add guard that refuses to run if DB looks like prod.*

---

## 2. Root Cause Analysis & Implemented Fixes

### Fix 1: Database Isolation & Production Protection Guard
- **Why it was unreliable**: Ambient test configurations without strict validation risk pointing to production or development databases (`upsk_sdf`), leading to catastrophic data loss during teardown (`deleteMany({})`).
- **Implemented Fix**:
  In [`api/scripts/verify-module-09.ts:57-105`](file:///D:/Knack%20labs/api/scripts/verify-module-09.ts#L57-L105), [`validateDatabaseIsolation()`](file:///D:/Knack%20labs/api/scripts/verify-module-09.ts#L57) enforces:
  1. **Anti-Prod Inspection**:
     ```ts
     const lowerUrl = rawUrl.toLowerCase();
     if (
       lowerUrl.includes('prod') ||
       lowerUrl.includes('production') ||
       lowerUrl.includes('live') ||
       lowerUrl.includes('staging') ||
       lowerUrl.includes('rds.amazonaws.com') ||
       lowerUrl.includes('railway.app')
     ) {
       throw new Error('CRITICAL SAFETY VIOLATION: Database URL appears to target production/staging! Refusing execution.');
     }
     ```
  2. **Strict Test Database Matching**: Enforces `dbName === 'upsk_sdf_test'`, `host === 'localhost' || host === '127.0.0.1'`, `port === '5432'`, and `NODE_ENV === 'test'`.
  3. **Immediate Abort**: Executes before opening any database connections.
  4. **Child Process Inheritance**: Both the test API server (`dist/main.js`) and the purge CLI (`dist/purge.js`) explicitly inherit `NODE_ENV: 'test'`, `DATABASE_URL: TEST_DATABASE_URL`, and `REDIS_URL: TEST_REDIS_URL`.
  5. **Safety Verification**: Real database row counts are verified before and after every test run (`links: 25 -> 25`, `clicks: 0 -> 0`).

---

### Fix 2: Edge-Case Assertions & Multi-Layer Verification
- **Why it was unreliable**: Shallow assertions checking only HTTP status codes (e.g. `res.status === 302`) provide false confidence while missing open redirect hijacks, missing error envelopes, or unauthorized DB mutations.
- **Implemented Fix**:
  1. **Redirect Correctness**: Asserts `res.status === 302` AND exact `Location` header matching the target long URL.
  2. **IDOR & Data Integrity**: Asserts Bob receives HTTP `404` for `GET`, `PATCH`, and `DELETE` on Alice's link, AND verifies that Alice's link long URL was **not modified** in the database.
  3. **Analytics Idempotency**: Asserts `AnalyticsService.persistClickEvent()` returns `status: 'duplicate_ignored'`, verifies that a duplicate raw insert triggers PostgreSQL unique constraint `P2002`, and asserts the final click count in storage is **exactly 1**.

---

### Fix 3: State Isolation & Determinism (Shared-State Contamination)
- **Why it was unreliable**: Tests that create persistent records without automated cleanup leave state behind, causing subsequent runs or concurrent workers to collide on unique keys (`P2002`) or return stale cache entries.
- **Implemented Fix**:
  1. **Deterministic Fixture Lifecycle**:
     - Pre-flight cleanup clears test tables before every run:
       ```ts
       await testPrisma.clickEvent.deleteMany({});
       await testPrisma.link.deleteMany({});
       ```
     - Scoped Redis flush: `await testRedis.flushdb()` flushes only Redis DB 1. `FLUSHALL` is strictly avoided.
  2. **Redis DB 0 Immutability**: The runner captures `devRedisKeysBefore` and `devRedisKeysAfter` on DB 0, asserting zero modification (`188 -> 188`).
  3. **Resource Teardown**: Top-level `try { ... } finally { ... }` terminates `apiProc` (SIGTERM with SIGKILL escalation) and disconnects all Redis and Prisma clients even if an assertion throws.

---

## 3. Proof of Determinism: 5 Consecutive Runs (65 / 65 Checks Passed)

To satisfy the Upsk requirement (*"prove determinism (run test multiple times)"*) and adhere to the rule (*"Do not claim a test is non-flaky based on a single successful run"*), `npm test` was executed 5 consecutive times:

| Run Number | Timestamp (UTC) | Checks Passed | Dev DB Rows (`upsk_sdf`) | Redis DB 0 Keys | Result |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **Run 1** | 2026-11-13T08:49:35Z | **13 / 13** | `25 -> 25` | `188 -> 188` | **PASS** |
| **Run 2** | 2026-11-13T08:49:53Z | **13 / 13** | `25 -> 25` | `188 -> 188` | **PASS** |
| **Run 3** | 2026-11-13T08:50:12Z | **13 / 13** | `25 -> 25` | `188 -> 188` | **PASS** |
| **Run 4** | 2026-11-13T08:50:30Z | **13 / 13** | `25 -> 25` | `188 -> 188` | **PASS** |
| **Run 5** | 2026-11-13T08:50:48Z | **13 / 13** | `25 -> 25` | `188 -> 188` | **PASS** |
| **TOTAL** | | **65 / 65** | **Zero Leaks** | **Zero Leaks** | **100% Deterministic** |

- **Flakiness Rate**: **0.0%**
- **Full execution log**: [`progress/evidence/module-09/determinism-proof.txt`](file:///D:/Knack%20labs/progress/evidence/module-09/determinism-proof.txt)

---

## 4. Full Regression Results (Modules 04–08)

All historical regression suites remain 100% passing and completely unmodified:

| Module | Script | Checks | Result | Evidence File |
| :--- | :--- | :---: | :---: | :--- |
| **Module 04: Auth & Rate Limiting** | [`verify-module-04.ts`](file:///D:/Knack%20labs/api/scripts/verify-module-04.ts) | **31 / 31** | **PASS** | [`auth-ratelimit-tests.txt`](file:///D:/Knack%20labs/progress/evidence/module-04/auth-ratelimit-tests.txt) |
| **Module 05: Logging & Error Handling** | [`verify-module-05.ts`](file:///D:/Knack%20labs/api/scripts/verify-module-05.ts) | **26 / 26** | **PASS** | [`error-logging-tests.txt`](file:///D:/Knack%20labs/progress/evidence/module-05/error-logging-tests.txt) |
| **Module 06: Redis Cache-Aside** | [`verify-module-06.ts`](file:///D:/Knack%20labs/api/scripts/verify-module-06.ts) | **33 / 33** | **PASS** | [`redis-cache-tests.txt`](file:///D:/Knack%20labs/progress/evidence/module-06/redis-cache-tests.txt) |
| **Module 07: BullMQ Analytics & Purge** | [`verify-module-07.ts`](file:///D:/Knack%20labs/api/scripts/verify-module-07.ts) | **21 / 21** | **PASS** | [`analytics-jobs-tests.txt`](file:///D:/Knack%20labs/progress/evidence/module-07/analytics-jobs-tests.txt) |
| **Module 08: PostgreSQL Search & GIN** | [`verify-module-08.ts`](file:///D:/Knack%20labs/api/scripts/verify-module-08.ts) | **17 / 17** | **PASS** | [`search-tests.txt`](file:///D:/Knack%20labs/progress/evidence/module-08/search-tests.txt) |
| **Module 09: Integration Testing Suite** | [`verify-module-09.ts`](file:///D:/Knack%20labs/api/scripts/verify-module-09.ts) | **13 / 13** | **PASS** | [`integration-tests.txt`](file:///D:/Knack%20labs/progress/evidence/module-09/integration-tests.txt) |
| **TOTAL** | | **141 / 141** | **100% PASS** | |

---

## 5. Summary of Files & State
- **Enhanced**: [`api/scripts/verify-module-09.ts`](file:///D:/Knack%20labs/api/scripts/verify-module-09.ts) (added anti-prod guard, strict URL parsing, Redis isolation, determinism).
- **Created**: [`progress/evidence/module-09/determinism-proof.txt`](file:///D:/Knack%20labs/progress/evidence/module-09/determinism-proof.txt) (5-run repeatability proof).
- **Created**: [`progress/evidence/module-09/fix-report.md`](file:///D:/Knack%20labs/progress/evidence/module-09/fix-report.md) (official FIX report).
- **Untouched**: `progress/state.json`, Prisma schema & migrations, and Modules 04–08 verification scripts.

---

## 6. Current Upsk Status
- **Module**: `MODULE 09 — Testing`
- **Step**: `STEP 6: FIX`
- **Progress**: `86%`

*Execution has been stopped at STEP 6: FIX per instructions. Ready for user review before proceeding to STEP 7: REFLECT.*

