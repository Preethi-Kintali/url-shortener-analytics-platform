# Module 08 — Step 5: Break Analysis (Deploy & Verify Capstone)

## Executive Summary
During post-deployment operations, three critical production failure modes were observed while platform-level health indicators reported green:
1. Real business endpoints returning HTTP 5xx while `/ready` returns 200.
2. Memory consumption steadily climbing without plateauing.
3. Out-of-band configuration drift between running containers and the CI/CD pipeline.

---

## 1. Problem 1: The Green Readiness Fallacy
### Diagnosis
- The `/ready` endpoint executes `SELECT 1` on PostgreSQL and `PING` on Redis.
- While these queries verify low-level network socket connectivity, they do NOT guarantee that:
  - Database schema migrations have executed (`prisma migrate deploy`).
  - Required application tables or columns exist.
  - Connection pools are not exhausted under application query concurrency.
  - Authentication middleware (`JWT_SECRET` validation) or request validation logic is healthy.
- **The Blind Spot:** A deployment with missing tables or misconfigured auth will pass readiness checks with flying colors, receive 100% of production traffic, and immediately break for every active user.

### Architectural Solution
- Keep `/live` strictly for process responsiveness and `/ready` for backing service connectivity.
- Supplement readiness gating with **automated synthetic smoke tests** in CI/CD and production monitoring. These tests execute end-to-end business transactions (e.g., generating a short link with test credentials, resolving it, and verifying redirect target) before traffic shifting is finalized.

---

## 2. Problem 2: Silent Memory Leak
### Diagnosis
- Node.js resident memory (`process_resident_memory_bytes`) monotonically increases over time.
- Common Root Causes in Node.js/NestJS:
  - **Unbounded Collections:** Global Maps or arrays caching request IDs, link metadata, or telemetry without TTL or LRU eviction limits.
  - **Event Listener Leaks:** Registering listeners on process or EventEmitter instances per request without detaching them upon response completion.
  - **AsyncLocalStorage Context Leaks:** Holding references to request objects in uncompleted asynchronous promise chains.
  - **Background Worker Accumulation:** BullMQ queues storing completed job outputs indefinitely in memory.

### Investigation & Remediation Strategy
1. **Profiling & Heap Diffs:** Capture heap snapshots at $T_0$, $T_0 + 60\text{m}$, and $T_0 + 120\text{m}$ under steady traffic. Compare retained size by constructor to isolate growing object trees.
2. **Runtime Telemetry:** Alert on `nodejs_heap_size_used_bytes` exceeding 80% container threshold, or continuous positive slope over a 60-minute evaluation window.
3. **Platform Protection:** Set container memory limits (`--memory=512m`) with orchestrator memory eviction policies to trigger rolling container replacement before hard kernel OOM panic.

---

## 3. Problem 3: Out-of-Band Configuration Drift
### Diagnosis
- Environment variables in running containers diverge from the version-controlled values defined in `.github/workflows/ci.yml` and repository configs.
- Why Engineers Drift Configuration:
  - Manual SSH/UI edits during late-night incident fire-fighting to apply immediate hotfixes.
- The Risk of "Snowflake" Deployments:
  - The manual hotfix is not tracked in source control.
  - The next automated CI/CD deployment overwrites the manual setting, re-triggering the original incident.
  - Replicas end up running heterogeneous configurations, causing non-deterministic behavior across traffic splits.

### Governance & Automated Guardrails
- **GitOps Single Source of Truth:** All configuration changes must flow through Git pull requests and CI/CD pipelines.
- **Platform RBAC:** Revoke direct SSH/write permissions to production container environments.
- **Automated Drift Detection:** Scheduled audit jobs compare running container environment hashes against repository configuration schemas, generating high-severity alert tickets upon divergence.
- **Emergency Incident Reconciliation:** Require that any emergency override is immediately committed to the repository and re-deployed through the pipeline to restore configuration parity.
