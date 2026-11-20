# AI-Augmented Engineering — Module 08: Ship It Master Roadmap & Checklist

**Skill**: AI-Augmented Engineering (`ai-augmented-engineering`)  
**Pack**: Operator (Pack 3: `spk_ai_augmented_engineering_operator`)  
**Module**: 08 — Ship It (Capstone Module)  
**Date Initiated**: November 19, 2026  
**Status**: IN PROGRESS — Continuous Autonomous Execution  

---

## Complete Course Journey Status

| Module / Milestone | Status | Score | Key Output Artifact |
| :--- | :--- | :--- | :--- |
| **Module 01: The AI Engineering Mindset** | COMPLETED | 5.0/5.0 | Task-by-task decomposition, prompt hygiene |
| **Module 02: Prompt Decomposition** | COMPLETED | 5.0/5.0 | Complete 9-task collaboration feature tree |
| **Interlude: Therac-25** | COMPLETED | Accepted | Operator trust boundaries |
| **Module 03: Context Engineering** | COMPLETED | 5.0/5.0 | Context Triangle (arch, local, constraints) |
| **Module 04: Critical Review** | COMPLETED | 5.0/5.0 | IDOR detection, 5-failure review lens |
| **Interlude: Samsung AI Code Leak** | COMPLETED | Accepted | IP & secret leakage boundaries |
| **Module 05: Iteration Patterns** | COMPLETED | 5.0/5.0 | WebSocket replay, Two-Iteration Rule |
| **Module 06: Parallel Agent Management** | COMPLETED | 10.0/10.0 | Interface-First contracts, 3-agent coordination |
| **Interlude: Boeing 737 MAX** | COMPLETED | Accepted | Automation vs human override authority |
| **Module 07: Security & Architecture Review** | COMPLETED | 10.0/10.0 | Composite privilege escalation fix, 12-point checklist |
| **Interlude: SolarWinds Hack** | COMPLETED | Accepted | Supply chain trust, flaws that look right |
| **Module 08: Ship It (Active)** | **ACTIVE** | Pending | Production readiness, CI/CD, documentation, rollback |
| **Final Course Graduation** | Pending | Pending | Final comprehensive evaluation & certification |

---

## Module 08 Step-by-Step Execution Checklist

- [ ] **Step 1: CONTEXT — The Last Mile**
  - [x] Read official instructions & constraints
  - [ ] Author Step 1 Context analysis: [last-mile-context.md](evidence/module-08/last-mile-context.md)
  - [ ] Submit Step 1 proof (`upsk next`)
  - [ ] Verify transition to Step 2 DECIDE

- [ ] **Step 2: DECIDE — Deployment / Release Strategy**
  - [ ] Retrieve official decision options (e.g., Canary vs Blue/Green or Monolithic vs Staged)
  - [ ] Evaluate trade-offs based on database migrations, rollback risk, and test signal
  - [ ] Submit official decision command (`upsk decide <CHOICE> --reasoning "..."`)
  - [ ] Verify transition to Step 3 BUILD

- [ ] **Step 3: BUILD — The Production-Ready Release Package**
  - [ ] Retrieve official build specifications (CI pipeline, docs, regression suite, migration script)
  - [ ] Author production-grade documentation for the collaboration system
  - [ ] Wire unified regression harness into CI workflow specification
  - [ ] Author rollback and database migration plan
  - [ ] Submit Step 3 proof (`upsk next`)
  - [ ] Verify transition to Step 4 VERIFY

- [ ] **Step 4: VERIFY — End-to-End Release Validation**
  - [ ] Execute full end-to-end integration flow across all modules
  - [ ] Verify test suite runs in hermetic environment with zero manual steps
  - [ ] Confirm clean CI status
  - [ ] Submit Step 4 proof (`upsk next`)
  - [ ] Verify transition to Step 5 BREAK

- [ ] **Step 5: BREAK — The CI / Environment Failure**
  - [ ] Retrieve official break scenario (e.g. CI failure, missing dependency, environment divergence)
  - [ ] Diagnose root cause of environment-specific breakage
  - [ ] Reproduce failure deterministically and capture logs
  - [ ] Submit Step 5 proof (`upsk next`)
  - [ ] Verify transition to Step 6 FIX

- [ ] **Step 6: FIX — Hermetic Production Remediation**
  - [ ] Apply permanent fix to CI configuration / environment dependencies
  - [ ] Re-run all tests in clean environment
  - [ ] Verify green CI signal
  - [ ] Submit Step 6 proof (`upsk next`)
  - [ ] Verify transition to Step 7 REFLECT

- [ ] **Step 7: REFLECT — The Complete Retrospective**
  - [ ] Synthesize all 8 modules of the AI-Augmented Engineering journey
  - [ ] Submit official module evaluation report (`upsk report`)
  - [ ] Submit Step 7 proof (`upsk next`)
  - [ ] Verify Module 08 and complete course graduation status

---

## Guardrails & Execution Rules
1. Zero modifications to tracked production code in `api/src/` unless explicitly mandated by the task.
2. All artifacts and test suites isolated in `progress/evidence/module-08/` and mirrored to `progress/`.
3. Working tree on `github-public` must remain clean on all tracked files; no commits or pushes.
4. Continuous automated transitions from step to step without halting for manual prompts.
