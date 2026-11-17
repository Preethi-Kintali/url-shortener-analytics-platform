# Upsk Module 09: Testing — BREAK Step Report

**Date**: 2026-11-13  
**Project**: Upsk System Design Fundamentals — Operator Pack  
**Module**: Module 09 — Testing  
**Current Step**: STEP 5: BREAK  
**Workspace**: `D:\Knack labs`  
**API Root**: `D:\Knack labs\api`  
**Evidence File**: [`test-break-repro.txt`](file:///D:/Knack%20labs/progress/evidence/module-09/test-break-repro.txt)

---

## 1. Official BREAK Context & Objectives

In Module 09 STEP 5: BREAK, Upsk provides three adaptive testing failure modes:
1. **Easy**: Test accidentally targets or mutates the real/development database.
2. **Medium**: Missing assertions for critical edge cases leading to false confidence.
3. **Hard**: Flaky tests caused by shared mutable state and omitted teardown/cleanup across test runs.

All three failure modes were reproduced in an isolated, controlled script: [`repro-module-09-break.ts`](file:///D:/Knack%20labs/api/scripts/repro-module-09-break.ts), executing strictly against the isolated test environment (`upsk_sdf_test` and Redis DB 1) without touching development or production data.

---

## 2. Failure Experiments, Symptoms & Root Cause Analysis

### Experiment 1: Test Accidentally Targets Real Database (`upsk_sdf`)
- **Symptom**: Without strict environment isolation, test runners inheriting default environment variables or running against `DATABASE_URL` (pointing to `upsk_sdf`) execute teardown commands such as `testPrisma.link.deleteMany({})`, immediately wiping all developer records and historical analytics.
- **Reproduction**:
  - Simulated an unsafe test runner initialized with development URL `postgresql://postgres:postgres@localhost:5432/upsk_sdf`.
  - Executed [`validateDatabaseIsolation()`](file:///D:/Knack%20labs/api/scripts/repro-module-09-break.ts#L33-L71) against the development URL.
- **Observed Output**:
  ```
  Database URL validation failed: CRITICAL SAFETY VIOLATION: Target database "upsk_sdf" is not the approved test database "upsk_sdf_test"! Refusing execution.
  ```
- **Root Cause**: Relying on ambient configuration rather than defensive assertions at test startup.
- **Production Defense**: The pre-flight isolation guard parses the connection URL, strictly verifies `dbName === 'upsk_sdf_test'`, `host === 'localhost'`, `port === '5432'`, and `env === 'test'`, immediately aborting before opening any database connections.

---

### Experiment 2: Missing Assertions & False Confidence in Edge Cases
- **Symptom**: Tests report green / passing status while critical security bugs or functional regressions slip into production unnoticed.
- **Reproduction**:
  - Simulated a redirect response returning HTTP 302, but with an open-redirect vulnerability redirecting to `https://attacker.evil.com/phishing` instead of `https://docs.example.com/legitimate-page`.
  - Evaluated a weak test assertion (`res.status === 302`) versus a strict assertion (`res.status === 302 && location === targetUrl`).
- **Observed Output**:
  ```
  [PASS] EXPERIMENT 2.1: Weak assertion falsely passes despite malicious Location header — weakAssertStatus=302 -> passed=true
  [PASS] EXPERIMENT 2.2: Strict assertion catches the edge case and rejects malicious Location header — expected="https://docs.example.com/legitimate-page", got="https://attacker.evil.com/phishing"
  ```
- **Root Cause**: Shallow assertion design verifying only HTTP status codes without validating headers, response envelope structures, or side-effect state.
- **Production Defense**: Multi-point assertions verifying status, headers, and underlying database state (e.g., verifying `res.status === 404` on unauthorized PATCH *and* asserting the owner's long_url in the database remained unchanged).

---

### Experiment 3: Flaky Test Due to Shared State Across Runs
- **Symptom**: A test suite passes on the initial run in CI, but randomly fails when rerun or when tests execute concurrently, throwing unique constraint errors or returning stale cached data.
- **Reproduction**:
  - Run 1 inserts a click event with `idempotencyKey = 'fixed_shared_key_12345'` into the database and exits without cleanup.
  - Run 2 attempts to run the identical test suite.
- **Observed Output**:
  ```
  [RUN 1] Executing test iteration 1 without cleanup...
  [PASS] EXPERIMENT 3.1: Run 1 passes successfully and commits record to database — idempotencyKey=fixed_shared_key_12345
  [RUN 2] Executing identical test iteration 2 with shared dirty state...
  [PASS] EXPERIMENT 3.2: Run 2 crashes with P2002 Unique Constraint Violation due to uncleaned shared state — code=P2002, meta={"modelName":"ClickEvent","target":["idempotency_key"]}
  ```
- **Root Cause**: Lack of test isolation; previous runs leave state in persistent stores, causing collisions on deterministic unique keys.
- **Production Defense**:
  - Pre-test and post-test automated cleanup:
    ```ts
    await testPrisma.clickEvent.deleteMany({});
    await testPrisma.link.deleteMany({});
    await testRedis.flushdb();
    ```
  - Executing Run 3 after deterministic cleanup succeeds 100%:
    ```
    [CLEANUP & FIX] Applying deterministic cleanup before Run 3...
    [PASS] EXPERIMENT 3.3: Run 3 passes deterministically after applying automated cleanup — idempotencyKey=fixed_shared_key_12345
    ```

---

## 3. Summary of Changes Made
- **Created**: [`api/scripts/repro-module-09-break.ts`](file:///D:/Knack%20labs/api/scripts/repro-module-09-break.ts) (standalone reproduction script).
- **Generated**: [`progress/evidence/module-09/test-break-repro.txt`](file:///D:/Knack%20labs/progress/evidence/module-09/test-break-repro.txt) (7/7 checks passed).
- **Production Application Code**: 0 bytes modified.
- **Previous Verification Scripts (Modules 04–08)**: 0 bytes modified.
- **Prisma Schema & Migrations**: 0 bytes modified.
- **State File (`progress/state.json`)**: 0 bytes modified.

---

## 4. Current Upsk Status
- **Module**: `MODULE 09 — Testing`
- **Step**: `STEP 5: BREAK`
- **Progress**: `86%`

*Execution has been stopped at STEP 5: BREAK per instructions. Ready for user review before proceeding to FIX or REFLECT.*

