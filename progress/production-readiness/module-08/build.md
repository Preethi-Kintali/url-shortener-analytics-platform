# Module 08 — Step 3: Build Documentation (Deploy & Verify Capstone)

## Overview & Architecture
Module 08 integrates all prior operational modules (multi-stage containerization, CI/CD automated gating, centralized validated environment configuration, Prometheus metrics, circuit breaking with graceful degradation, and runbooks) into a resilient, zero-downtime deployment and automated rollback pipeline.

---

## Chunk 1: Platform Setup & Secret Hygiene
- **Runtime Environment:** Containerized Node.js service orchestrated using immutable Docker images tagged with Git commit SHAs (`myservice:2fb26c6`).
- **Secret Management Posture:**
  - Production secrets (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGIN`) are stored in secure GitHub Actions environment secrets and platform secret managers, completely decoupled from source code, repository commits, and image layers.
  - Startup schema validation (`api/src/config.ts`) verifies presence, format, and minimum length (e.g. 32-char JWT secret) at boot time.
  - Secret names and presence are validated without echoing or logging plaintext values. All log outputs redact credential patterns and host IPs.

---

## Chunk 2: Liveness and Readiness Probe Hardening
In `api/src/health/health.controller.ts` and `api/src/prisma/prisma.service.ts`:

1. **Lightweight Liveness Probe (`GET /live`):**
   - Answers: *"Is the Node.js event loop responsive?"*
   - Returns immediate HTTP 200 `{ ok: true }` without touching database or cache.
   - Prevents cascading container restarts when backing databases or network partitions occur.

2. **Gated Readiness Probe (`GET /ready`):**
   - Answers: *"Is this instance fully ready to accept user ingress traffic?"*
   - Checks PostgreSQL and Redis health using short 2-second fail-fast timeout boundaries (`Promise.race` with timer cleanup) to prevent probe stalling under database contention.
   - Response Payload:
     ```json
     {
       "ok": true,
       "checks": {
         "database": "connected",
         "cache": "connected",
         "uptime_seconds": 3
       },
       "status": "ready",
       "db": "ok",
       "redis": "ok"
     }
     ```
   - When any dependency fails or times out, returns HTTP 503 Service Unavailable with explicit failure diagnostics (`database: disconnected`).

---

## Chunk 3: CI/CD Pipeline Integration & Policy
In `.github/workflows/ci.yml`:

- **Gated Deploy Stage:**
  - Triggers only after `lint`, `test`, and `build` stages succeed on `main`.
  - Tags images with immutable Git commit SHA: `myservice:${{ github.sha }}`.
  - Deploys container and runs a 30-attempt readiness polling loop (up to 150 seconds).
  - Executes smoke tests validating HTTP 200 on `/live`, `/ready`, and `/metrics`.
  - Triggers automated rollback if any smoke check fails.
- **Friday 5 PM Deployment Stance:**
  - **Option B — Manual Approval Gate:** Production deployments require explicit authorization from an on-call engineer or peer reviewer outside normal working hours.
  - Rationale: While automated probes catch technical failures, human review prevents business-level regressions and ensures on-call coverage is actively watching the release. Critical hotfixes use an expedited review path.

---

## Chunk 4: Rollback & Failure-First Verification Drill Evidence

An automated drill was executed via `rollback-drill.js` simulating real-world production deployment failure, gating, and automated rollback:

### 1. Known-Good Deployment (`myservice:2fb26c6`)
- Container ID: `0627f1796481`
- `GET /live`: HTTP 200 `{"ok":true}`
- `GET /ready`: HTTP 200 `{"ok":true,"checks":{"database":"connected","cache":"connected","uptime_seconds":3}}`
- `GET /metrics`: HTTP 200 (10,876 bytes Prometheus metrics)

### 2. Deliberately Broken Candidate / Corrupted `DATABASE_URL`
- Container ID: `f9411cedf00c`
- `GET /live`: HTTP 200 `{"ok":true}` (Process alive)
- `GET /ready`: HTTP 503 `{"ok":false,"checks":{"database":"disconnected","cache":"connected","uptime_seconds":3}}`
- **Gating Decision:** Rollout immediately halted. Traffic was never routed to the broken candidate.

### 3. Automated Rollback Execution
- Target Image: `myservice:2fb26c6`
- Restored Container ID: `6fc572dd5643`
- **Rollback Elapsed Time:** **4.28 seconds** (SLA target: <120 seconds).
- Post-Rollback `GET /live`: HTTP 200 `{"ok":true}`
- Post-Rollback `GET /ready`: HTTP 200 `{"ok":true,"checks":{"database":"connected","cache":"connected","uptime_seconds":2}}`
- Post-Rollback `GET /metrics`: HTTP 200 OK

### 4. Failure-First Truthfulness Audit
- Database Connectivity Truthful: `true` (accurately failed on unreachable host, accurately passed on valid host).
- Cache Connectivity Truthful: `true`.
- Overall Verdict: **PASSED (100% Truthful)**
