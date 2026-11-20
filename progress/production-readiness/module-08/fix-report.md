# Module 08 — Step 6: Fix Report (Deploy & Verify Capstone)

## Executive Summary
This report documents the resolution of all three production failure modes identified during Step 5 (BREAK). Every fix was implemented using the operational tools developed throughout the bootcamp: Prometheus observability (Module 04), failure mode analysis (Module 05), circuit breaking (Module 06), and production runbooks (Module 07).

---

## 1. Fix 1: Business Smoke Testing & Readiness Separation
- **Root Problem:** `/ready` only executed `SELECT 1` and Redis `PING`. A deployment with unmigrated database tables or broken authentication middleware passed readiness checks and received traffic despite being broken for users.
- **Architectural Fix:**
  - Kept `/live` lightweight and dependency-free.
  - Kept `/ready` focused on dependency socket connectivity with 2s timeouts.
  - Augmented the deployment pipeline in `.github/workflows/ci.yml` and post-deploy validation with **synthetic smoke tests** executing real link creation (`POST /links`) and redirection.
  - Authored **Runbook 4: Silent Business Degradation** in `docs/runbooks.md` detailing migration checks (`prisma migrate status`), emergency deployment rollback commands, and end-to-end verification.

---

## 2. Fix 2: Memory Leak Detection & Saturation Guardrails
- **Root Problem:** Slow memory creep in Node.js heap and RSS escaping shallow liveness/readiness probes until reaching container limits and triggering an ungraceful OOM panic.
- **Architectural Fix:**
  - Enforced bounded in-memory cache TTLs (`MAX_REDIRECT_CACHE_TTL_SECONDS = 3600`) and LRU eviction limits.
  - Added Prometheus alert rule `MemorySaturationWarning` in `infra/prometheus-alerts.yml`:
    ```yaml
    - alert: MemorySaturationWarning
      expr: process_resident_memory_bytes > 400000000
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "Node.js resident memory exceeds 400MB threshold"
    ```
  - Authored **Runbook 5: Node.js Memory Creep & Unbounded Heap Saturation** in `docs/runbooks.md` providing step-by-step heap inspection, event loop lag profiling, rolling restart mitigation, and rollback triggers.

---

## 3. Fix 3: Out-of-Band Configuration Drift Remediation
- **Root Problem:** Manual edits made on platform consoles or containers during fire-fighting created snowflake environments that diverged from Git, risking regression on subsequent CI/CD deploys.
- **Architectural Fix:**
  - Re-aligned the running container environment with the canonical configuration defined in the repository.
  - Enforced the GitOps principle: all production configuration changes must be reviewed and deployed through version-controlled pull requests.
  - Authored **Runbook 6: Out-of-Band Configuration Drift Remediation** in `docs/runbooks.md` with copy-pasteable environment diff commands, canonical reconciliation procedures, and mandatory post-incident Git commit rules.

---

## 4. Post-Fix Verification Audit
- `GET /live`: `HTTP 200 OK {"ok":true}`
- `GET /ready`: `HTTP 200 OK {"ok":true,"checks":{"database":"connected","cache":"connected","uptime_seconds":...}}`
- `GET /metrics`: `HTTP 200 OK` exposing `process_resident_memory_bytes` and alert metrics.
- All three runbooks (`docs/runbooks.md`) verified with copy-pasteable commands, dual-state expected outputs, and zero placeholder syntax.
- Memory usage confirmed stable; configuration confirmed 100% aligned with Git repository.
