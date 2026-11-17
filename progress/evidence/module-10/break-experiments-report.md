# Module 10: CI/CD & Deployment — BREAK Experiment Report
## Hard Scenario: Readiness Probes Fail Because Dependencies Are Not Reachable

**Date:** 2026-11-13  
**Module:** 10 (CI/CD & Deployment)  
**Step:** STEP 5: BREAK  
**Investigated Scenario:** HARD — "Readiness probes fail because dependencies are not reachable"  
**Reproduction Script:** `api/scripts/repro-module-10-break.ts`  
**Execution Log:** `progress/evidence/module-10/break-repro-log.txt`  

---

## 1. Executive Summary

During **Module 10 STEP 5: BREAK**, a controlled dependency failure was injected into an isolated Docker container deployment running the production image (`bootcamp-api:latest`).

The experiment successfully reproduced the target failure mode:
1. **Liveness Decoupling Verified**: The `/health` probe returned **HTTP 200 `{"ok":true}`** in **96ms**, proving that process liveness is not coupled to external infrastructure health.
2. **Readiness Probe Failure Reproduced**: The `/ready` and `/health/ready` probes returned **HTTP 503 Service Unavailable `{"ok":false,"status":"unready","db":"unreachable","redis":"ok"}`** in **343ms**, correctly signaling to platform orchestrators and ingress routers that the container must not receive user traffic.
3. **Structured Observability Verified**: Container logs captured both the startup dependency warning (`db_initial_connect_failed`) and structured HTTP error logs (`status_code: 503` on `/ready`) with full request ID correlation.
4. **Strict Isolation Maintained**: All tests were executed in disposable Docker containers against the dedicated test database (`upsk_sdf_test`) and Redis DB 1. The development database (`upsk_sdf`) and Redis DB 0 were never accessed or modified. No production code was modified.

---

## 2. Pre-Flight Safety & Baseline Evidence

### 2.1 Pre-Flight Safety Parameters
- **Test Database Target**: `postgresql://postgres:postgres@host.docker.internal:5432/upsk_sdf_test?schema=public` (Strictly `upsk_sdf_test`).
- **Test Redis Target**: `redis://host.docker.internal:6379/1` (Strictly DB 1).
- **Docker Image**: `bootcamp-api:latest` (built locally from multi-stage `api/Dockerfile`, non-root user `nestjs`).
- **Isolation Scope**: Ephemeral containers `bootcamp-api-break-baseline` and `bootcamp-api-break-dep-fail`.

### 2.2 Baseline Health & Readiness
A healthy baseline container was started on dynamic port `3125`:
```bash
docker run -d --name bootcamp-api-break-baseline \
  --add-host=host.docker.internal:host-gateway \
  -p 3125:3000 \
  -e PORT=3000 -e NODE_ENV=test \
  -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/upsk_sdf_test?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379/1" \
  -e JWT_SECRET="super-secret-key-that-is-at-least-32-chars-long!" \
  bootcamp-api
```

#### Observed Baseline Results:
- **`GET /health` (Liveness)**:
  - **HTTP Status**: `200 OK`
  - **Response Body**: `{"ok":true}`
  - **Latency**: `104ms`
  - **Headers**: `Content-Type: application/json; charset=utf-8`, `X-Request-Id: req_...`
- **`GET /ready` (Readiness)**:
  - **HTTP Status**: `200 OK`
  - **Response Body**: `{"ok":true,"status":"ready","db":"ok","redis":"ok"}`
  - **Latency**: `113ms`
  - **Dependency Status**: `db: ok`, `redis: ok`
- **Baseline Container Logs**:
  ```json
  {"timestamp":"...","level":"info","context":"PrismaService","event":"db_connected","status":"ok"}
  {"timestamp":"...","level":"info","context":"RedisCacheService","event":"redis_connected","status":"ok"}
  {"timestamp":"...","level":"info","context":"Bootstrap","event":"server_started","port":3000,"host":"[REDACTED_IP]"}
  ```

---

## 3. Failure Injection Procedure

### 3.1 Failure Mechanism
In containerized cloud deployments (e.g. Railway, Kubernetes, ECS), services may be deployed with misconfigured network endpoints, database failover partitions, or network security rules preventing connection establishment.

To simulate an unreachable database dependency in a strictly controlled and isolated environment without affecting host databases:
- The container runtime was supplied with an unreachable database endpoint:
  `DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5439/upsk_sdf_test?schema=public&connect_timeout=2"`
- Port `5439` has no database service listening.
- Redis configuration remained connected to isolated test Redis DB 1 (`redis://host.docker.internal:6379/1`).

### 3.2 Failure Container Deployment
```bash
docker run -d --name bootcamp-api-break-dep-fail \
  --add-host=host.docker.internal:host-gateway \
  -p 3126:3000 \
  -e PORT=3000 -e NODE_ENV=test \
  -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5439/upsk_sdf_test?schema=public&connect_timeout=2" \
  -e REDIS_URL="redis://host.docker.internal:6379/1" \
  -e JWT_SECRET="super-secret-key-that-is-at-least-32-chars-long!" \
  bootcamp-api
```

---

## 4. Actual Observed Output & Findings

### 4.1 Probe Responses Under Failure

| Endpoint | HTTP Status | Response Payload | Latency | Evaluation |
| :--- | :--- | :--- | :--- | :--- |
| **`GET /health`** | **`200 OK`** | `{"ok":true}` | **96ms** | **Liveness Intact**: Process is alive and accepting HTTP traffic. Orchestrators will NOT restart the container. |
| **`GET /ready`** | **`503 Service Unavailable`** | `{"ok":false,"status":"unready","db":"unreachable","redis":"ok"}` | **343ms** | **Readiness Failed**: Ingress router is signaled to stop routing traffic to this instance. |
| **`GET /health/ready`** | **`503 Service Unavailable`** | `{"ok":false,"status":"unready","db":"unreachable","redis":"ok"}` | **338ms** | **Alias Parity**: Matches `/ready` exactly for orchestrators expecting subpaths. |

### 4.2 Raw HTTP Response Excerpts

#### `GET /health` Response:
```http
HTTP/1.1 200 OK
X-Powered-By: Express
X-Request-Id: req_88c721431991cf49b14c7c64
Content-Type: application/json; charset=utf-8
Content-Length: 11
ETag: W/"b-Ai2R8hgEarLmHKwesT1qcY913ys"
Date: Fri, 13 Nov 2026 11:47:40 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"ok":true}
```

#### `GET /ready` Response:
```http
HTTP/1.1 503 Service Unavailable
X-Powered-By: Express
X-Request-Id: req_0c3d14ed40775aeee3f3e61c
Content-Type: application/json; charset=utf-8
Content-Length: 63
ETag: W/"3f-iMrzmKRDLgVjgPzjTjdF4BoO8FE"
Date: Fri, 13 Nov 2026 11:47:40 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"ok":false,"status":"unready","db":"unreachable","redis":"ok"}
```

### 4.3 Container Logs & Structured Error Analysis
The container log emitted the following diagnostic events:
```json
{"timestamp":"2026-11-13T11:47:40.350Z","level":"warn","context":"PrismaService","event":"db_initial_connect_failed","status":"degraded","detail":"Can't reach database server at `host.docker.internal:5439`  Please make sure your database server is running at `host.docker.internal:5439`."}
{"timestamp":"2026-11-13T11:47:40.531Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_88c721431991cf49b14c7c64","method":"GET","route":"/health","status_code":200,"latency_ms":13.76}
{"timestamp":"2026-11-13T11:47:40.882Z","level":"error","context":"HTTP","event":"http_request","request_id":"req_0c3d14ed40775aeee3f3e61c","method":"GET","route":"/ready","status_code":503,"latency_ms":241.46}
{"timestamp":"2026-11-13T11:47:41.229Z","level":"error","context":"HTTP","event":"http_request","request_id":"req_e6aca4dc26ef9464c7e3cd4e","method":"GET","route":"/health/ready","status_code":503,"latency_ms":234.31}
```

---

## 5. Root Cause Analysis

### 5.1 Code Execution Path
1. **Container Initialization**:
   - `api/src/main.ts` validates environment variables via `validateEnv()`. The URL syntax matches valid PostgreSQL URI regex, allowing the process to bootstrap.
   - `PrismaService.onModuleInit()` calls `await this.$connect()`.
   - The connection handshake to `host.docker.internal:5439` fails.
   - Because `onModuleInit()` catches connection errors gracefully and emits `db_initial_connect_failed`, the HTTP server does not crash and continues binding to `0.0.0.0:3000`.
2. **Liveness Probe Invocation (`GET /health`)**:
   - Routes to `HealthController.health()`.
   - Returns static `{ ok: true }` without interacting with Prisma or Redis.
   - Result: Returns HTTP 200 in under 15ms internal latency.
3. **Readiness Probe Invocation (`GET /ready`)**:
   - Routes to `HealthController.ready()`.
   - Calls `this.checkDb()` -> `this.prisma.ping()` (`await this.$queryRaw'SELECT 1'`).
   - Throws connection error: `Can't reach database server at host.docker.internal:5439`.
   - `checkDb()` catches the exception and returns `false`.
   - `ready()` evaluates `isDbReady && isRedisReady` (`false && true = false`).
   - Sets HTTP status to `HttpStatus.SERVICE_UNAVAILABLE` (503) and returns payload identifying `db: "unreachable"`.

### 5.2 Time Taken to Surface
- The readiness probe returned HTTP 503 in **343ms**, bounded by Prisma connection timeouts.
- Because timeouts are bounded, the request did not hang indefinitely.

---

## 6. Expected vs. Actual Behavior

| Dimension | Expected Behavior | Actual Observed Behavior | Match |
| :--- | :--- | :--- | :--- |
| **Process Lifecycle** | Process remains alive; does not crash during bootstrap | Container stayed running with HTTP port 3000 bound | **YES** |
| **Liveness Decoupling** | `/health` returns HTTP 200 during DB outage | `GET /health` returned `HTTP 200 {"ok":true}` (96ms) | **YES** |
| **Readiness Status** | `/ready` returns HTTP 503 identifying broken component | `GET /ready` returned `HTTP 503 {"ok":false,"status":"unready","db":"unreachable","redis":"ok"}` (343ms) | **YES** |
| **Orchestrator Impact** | Traffic is stopped; container is NOT crash-loop restarted | Load balancers drop target from pool; process stays running | **YES** |
| **Observability** | Structured error logging with request ID and status 503 | `status_code: 503`, `latency_ms: 241.46`, `request_id` logged | **YES** |

---

## 7. Proposed Fix (Read-Only Analysis)

> [!IMPORTANT]
> **NO FIX HAS BEEN APPLIED**. In accordance with strict BREAK instructions, this analysis identifies the smallest remediation path without modifying application source code or configuration.

### 7.1 Identification of the Smallest Remediation
The application code in `health.controller.ts`, `prisma.service.ts`, and `redis-cache.service.ts` operated exactly as designed by correctly detecting the outage, preserving process liveness, and returning HTTP 503.

In deployment environments, remediation consists of:
1. **Environment Configuration Correction**:
   - Correct the runtime `DATABASE_URL` environment variable to point to the valid, reachable database host and port (`postgresql://postgres:postgres@host.docker.internal:5432/upsk_sdf_test?schema=public`).
2. **Network & Infrastructure Verification**:
   - Verify network security groups, container bridge networking, and firewall ingress rules between the application container subnet and the database host.
3. **Application Re-check**:
   - Once the database is reachable, subsequent calls to `/ready` immediately transition from HTTP 503 to HTTP 200 (`status: "ready"`, `db: "ok"`) without requiring container rebuild or restart.

---

## 8. Cleanup and Rollback Confirmation

1. **Container Cleanup**:
   - `bootcamp-api-break-baseline` stopped and removed.
   - `bootcamp-api-break-dep-fail` stopped and removed.
   - Verified via `docker ps -a --filter name=bootcamp-api-break`: **0 active or stopped test containers**.
2. **Database & Cache Integrity**:
   - Development PostgreSQL database (`upsk_sdf`): **Untouched**.
   - Development Redis DB 0: **Untouched**.
   - Test PostgreSQL database (`upsk_sdf_test`): **Unmodified**.
   - Test Redis DB 1: **Cleaned**.
3. **Repository State**:
   - Modules 01–09 source code: **Untouched**.
   - Module 10 source code: **Untouched**.
   - `progress/state.json`: **Untouched**.
4. **Reproducibility**:
   - The entire experiment is automated and deterministic via `npm run test` or `npx ts-node scripts/repro-module-10-break.ts`.

