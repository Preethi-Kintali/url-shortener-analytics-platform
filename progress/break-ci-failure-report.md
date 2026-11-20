# Module 08 — Step 5: BREAK — The CI Failure Report

**Session ID**: `C07G25jBzI5eMm8jXsZ1Z`  
**Pack**: Operator (`spk_ai_augmented_engineering_operator`)  
**Module**: Module 08 — Ship It  
**Step**: Step 5: BREAK (`break`)  
**Timestamp**: 2026-11-19T00:26:40Z  
**Failure Mode**: Environmental Coupling & State-Dependent CI Failure ("Works on My Machine")  

---

## 1. Incident Overview

During the automated CI pipeline execution for Module 08, all isolated unit, permission boundary, and edge-case tests passed with 100% green exit codes. However, the multi-stage end-to-end integration test abruptly failed with:

```text
Status Code: 404
Error Code:  NOT_FOUND
Message:     Team 'team_seeded_core_101' not found
```

When developers and AI agents executed the exact same integration test in their local developer workspaces, the test completed with **all steps passing (Green)**. 

This scenario represents the quintessential **"Works on My Machine, Fails in CI"** antipattern, amplified by AI-augmented engineering workflows.

---

## 2. Root Cause Analysis: Why AI Tests Fail in CI

### 2.1 The Environmental Horizon Fallacy
AI agents generating test suites suffer from a fundamental horizon limitation:
- An LLM inspects the currently available developer workspace and active database state.
- During active feature development (Modules 02–07), the developer's local PostgreSQL database or in-memory session was repeatedly populated with test users (`usr_seeded_alice`, `usr_bob`), existing teams, and lingering fixture records.
- When prompted to write an integration test verifying invitation dispatch and comment creation, the AI inspected the local state, observed that `team_seeded_core_101` and user `usr_seeded_alice` already existed, and wrote the test to consume those existing IDs directly.
- The AI possessed **no intrinsic concept of ephemeral runtime lifecycles**: it assumed that because an entity was present in its observation window, it was a permanent constant of the application runtime.

### 2.2 Local Dev vs. CI Environment Divergence

| Dimension | Local Developer Machine | Ephemeral CI Pipeline Runner |
|---|---|---|
| **Database Lifecycle** | Persistent, cumulative state from previous runs | Ephemeral container, spun up from blank image |
| **Initial State** | Populated with manual seeds, fixtures, dev teams | `EMPTY_DATABASE` (Zero pre-existing rows) |
| **User `usr_seeded_alice`** | Exists from earlier test runs | **Does not exist** |
| **Team `team_seeded_core_101`** | Exists from manual exploration | **Does not exist** |
| **Execution Result** | **PASSED (Green)** | **FAILED (404 NOT_FOUND / Exit Code 1)** |

When the CI pipeline executes, it starts with an empty database. The integration test attempts to issue an invitation to a team that was never created within that test execution, causing foreign key constraints or existence guards to reject the request with `404 NOT_FOUND`.

---

## 3. Empirical Reproduction & Execution Evidence

To verify this failure mode without relying on theoretical conjecture, an isolated reproduction harness was authored at [break-reproduction-ci-state.js](evidence/module-08/break-reproduction-ci-state.js).

### Reproduction Test Output Log:
```text
========================================================================
MODULE 08 STEP 5: BREAK — THE CI FAILURE REPRODUCTION
Timestamp: 2026-11-18T18:56:23.196Z
Simulating "Works on My Machine vs Fails in CI" Environment Divergence
========================================================================

------------------------------------------------------------------------
ENVIRONMENT A: LOCAL DEVELOPMENT (Dirty/Pre-Seeded State)
------------------------------------------------------------------------
[LOCAL SETUP] Pre-seeding existing database entities from dev session...
[LOCAL SETUP] Existing team present: id='team_1795028183202_3p4n8', owner='usr_seeded_alice'

[RUNNING AI-GENERATED TEST] Executing Test: "Invite Collaborator and Post Comment"
[PASS] Invitation created successfully: token=inv_tok_595eb80fa42699d6a5294f1e1f7d4ed3
[PASS] Bob accepted invitation
[PASS] Task created: id=tsk_1795028183205_h9vt
[PASS] Comment posted: id=cmt_1795028183206_ja1k

>>> LOCAL DEV TEST RESULT: ALL 4 STEPS PASSED (GREEN) <<<
Developer conclusion: "The feature and tests are completely working!"

------------------------------------------------------------------------
ENVIRONMENT B: CI PIPELINE (Pristine Ephemeral Empty Database)
------------------------------------------------------------------------
[CI SETUP] Pristine container database initialized. Pre-existing records: 0

[RUNNING AI-GENERATED TEST IN CI] Executing Test: "Invite Collaborator and Post Comment"
[CI EXECUTION] Attempting to invite collaborator to assumed team: 'team_seeded_core_101'...
[CI PIPELINE FAILURE - RED] Error caught during integration test:
  Status Code: 404
  Error Code:  NOT_FOUND
  Message:     Team 'team_seeded_core_101' not found

>>> CI PIPELINE RESULT: BUILD FAILED (EXIT CODE 1) <<<
Root Cause: Integration test made an ungrounded assumption of pre-existing database fixtures.
The test did not hermetically create its own prerequisites in a deterministic lifecycle.

========================================================================
SUMMARY OF DIVERGENCE:
  Local Environment: PASSED (Green)
  CI Environment:    FAILED (Red)
Diagnosis: AI test generator leaked environmental assumptions into integration suite.
========================================================================
```

---

## 4. The Engineering Fix Requirements (Roadmap to Step 6)

To permanently remediate this CI failure and make the test suite fully production-ready, the test suite must adhere to the **Hermetic Test Invariant**:

1. **Deterministic Lifecycle (Zero-Precondition Testing)**:
   - An integration test must never assume the existence of any pre-existing user, team, task, or configuration.
   - Every prerequisite resource must be created explicitly by the test suite itself in a setup phase or at the start of the test flow.

2. **Isolated Ephemeral IDs**:
   - Dynamic resource identifiers (e.g. `team_${Date.now()}_${random}`) must be generated and threaded through downstream test steps, rather than hardcoding static IDs.

3. **Autonomous Teardown**:
   - The test must clean up after itself or operate within isolated transactional rollbacks, preventing state leakage across parallel test workers.

4. **CI Matrix Parity**:
   - Local test execution commands must be parameterized with a flag or container wrapper (e.g. `--pristine-state`) ensuring developers execute against the exact same clean state as the CI pipeline runner.
