# Module 10: CI/CD & Deployment (Railway) — DECIDE Tradeoff Analysis

## 1. Context & Decision Scope

In **Module 10 (CI/CD & Deployment on Railway)**, we reach the final architectural decision of the System Design Fundamentals Operator Pack:
**Deployment Strategy: Single Container vs. Multi-Service**.

- **Decision Key**: `decisions.module_10.deploy_strategy`
- **Options**:
  - **Option A**: `single_container` (API web service handles HTTP requests and runs in-process or co-located background queue worker).
  - **Option B**: `multi_service` (Decoupled architecture: dedicated HTTP API service, dedicated BullMQ worker service, managed PostgreSQL, and managed Redis).

---

## 2. In-Depth Tradeoff Comparison

| Dimension | Option A: Single Container (`single_container`) | Option B: Multi-Service (`multi_service`) |
| :--- | :--- | :--- |
| **Architectural Model** | Monolithic container running HTTP API and worker logic. | Independent micro-services for HTTP API and Queue Worker. |
| **Fault Isolation** | **Coupled**: Worker fatal error or memory leak crashes API server. | **Isolated**: Worker crashes do not impact HTTP 302 redirects. |
| **Resource Contention** | Shared Node.js event loop / CPU; heavy batch jobs can delay redirects. | Dedicated CPU/RAM for API and Worker; zero event-loop interference. |
| **Scaling Flexibility** | Coupled scaling: scaling API instances multiplies worker instances. | Independent horizontal scaling based on HTTP RPS vs. Queue Depth. |
| **Operational Overhead** | **Very Low**: Single container, single build, single dashboard. | **Moderate**: Multiple services, separate env vars and logs in Railway. |
| **Rollback Simplicity** | **Atomic**: One-click rollback restores both API and worker simultaneously. | **Coordinated**: Requires backward-compatible schemas and dual rollbacks. |
| **Platform Cost** | Minimal container footprint (single container memory allotment). | Higher platform resource consumption (multiple service allocations). |

---

## 3. Analysis of Probing Questions

### Question 1: What do we gain from a separate worker deploy?
1. **Core Path Protection (HTTP 302 Latency SLA)**:
   - In Module 07, we established an asynchronous analytics queue specifically to decouple redirect latency from database write latency, achieving sub-40ms redirects.
   - If the BullMQ worker runs in the same container process as the API, high-volume event processing, retention purges (`purge.ts`), or database connection pool contention compete directly for the single Node.js event loop and host CPU.
   - A separate worker deploy guarantees that the public HTTP redirect path (`GET /r/:code`) has 100% dedicated compute and memory, immune to background job spikes.
2. **Failure Domain Isolation**:
   - If a poisonous job or unexpected data anomaly causes the worker process to exceed memory limits or throw an unhandled exception, only the worker container restarts.
   - The API service continues serving redirects and buffering new events in Redis without user impact.
3. **Independent Elastic Scaling**:
   - Web API scales horizontally based on HTTP throughput (requests per second) and CPU load.
   - Worker scales horizontally based on BullMQ backlog queue metrics (`waiting` jobs count).

### Question 2: What operational cost do we accept?
1. **Increased Orchestration Surface**:
   - Managing separate service configurations, start commands, health check paths, and log streams in Railway.
2. **Environment Variable Duplication & Synchronization**:
   - Both services require shared secrets (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`), requiring careful environment synchronization during updates or rotation.
3. **Connection Pool Multiplier**:
   - Two separate services connecting to PostgreSQL and Redis double the base connection pool footprint, requiring bounded pool configurations (`connection_limit`) to avoid exhausting PostgreSQL `max_connections`.

### Question 3: How do we roll back safely?
1. **Expand/Contract Schema Migrations**:
   - Because API and Worker may deploy or roll back independently, database schema changes must be backward-compatible (non-breaking):
     - Step 1: Add new optional columns/tables without removing old columns.
     - Step 2: Deploy new worker and API code.
     - Step 3: Remove deprecated columns only after all services run the new version.
2. **Safe Rollback Sequence**:
   - If a regression occurs:
     1. Roll back the API service first (or worker service, depending on where the fault lies).
     2. Because the database migration followed the expand/contract rule, the rolled-back service continues reading/writing existing valid columns without syntax or serialization errors.
3. **Queue Compatibility**:
   - BullMQ job payload schemas must support versioning or optional fields so old workers can process newly queued jobs and vice versa during rolling deployments.

---

## 4. Evaluation & Recommendation

### Recommendation: **Option B — Multi-Service (`multi_service`)**
- **Rationale**:
  - In Module 07, we explicitly decoupled HTTP redirects from database persistence using BullMQ and Redis queues to preserve our sub-40ms latency SLA and 99.99% redirect availability.
  - Choosing **Option B (`multi_service`)** honors that architectural contract in production:
    - `api`: Dedicated web container running `npm run start` (`dist/main.js`), with explicit `0.0.0.0` binding, `/health` and `/health/ready` probes, and graceful shutdown hooks.
    - `worker`: Dedicated background container running `npm run worker` (`dist/worker.js`), scaling against BullMQ queue depth.
    - `postgres`: Authoritative database managed by Railway.
    - `redis`: Low-latency cache and job broker managed by Railway.
- **Rollback Safety**: Backed by idempotent `prisma migrate deploy` and backward-compatible schema design.

---

### Alternative: **Option A — Single Container (`single_container`)**
- If minimizing operational complexity or platform cost is the dominant priority for small-scale deployments, Option A packages the API and worker into a single container or in-process queue worker.
- However, for an Operator-tier production architecture designed for high availability and zero core-path disruption, Option B is the industry standard.

---

## 5. Official Recorded Decisions for Module 10

### Primary Decision: Deployment Strategy
- **Key**: `decisions.module_10.deploy_strategy`
- **Choice**: `multi_service` (Option B)
- **Status**: Officially recorded in Upsk session state on `2026-11-13T09:07:56.452Z`.
- **Reasoning**: "I selected a multi-service deployment because the NestJS HTTP API and BullMQ background worker have different workloads, scaling requirements, and failure characteristics. Separating them prevents background processing failures or resource contention from directly affecting HTTP redirect traffic. PostgreSQL and Redis will remain separate managed services. Although this introduces additional deployment and configuration complexity, it provides better fault isolation, independent scaling, and operational flexibility."

### Secondary Implementation Decision: Migration Strategy
- **Key**: `decisions.module_10.migration_strategy`
- **Choice**: `one_off` (Option B)
- **Status**: Approved and recorded for BUILD execution.
- **Reasoning**: "I selected a one-off migration strategy because the application uses a multi-service deployment with separate API and BullMQ worker services. Running migrations automatically during each service startup can create concurrency risks and couple application availability to schema migration execution. A dedicated migration task provides controlled execution, clearer failure handling, and predictable deployment ordering. I will use Prisma migrate deploy and maintain backward-compatible expand-and-contract migrations to support safe deployments and rollback scenarios."


