# Module 10: CI/CD & Deployment — FIX Recovery Report
## Restoration of Dependency Routing & Readiness Probe Verification

**Date:** 2026-11-13  
**Module:** 10 (CI/CD & Deployment)  
**Step:** STEP 5: BREAK / FIX Preparation  
**Target Failure:** "Readiness probes fail because dependencies are not reachable"  
**Recovery Script:** `api/scripts/verify-module-10-fix.ts`  
**Execution Log:** `progress/evidence/module-10/fix-repro-log.txt`  

---

## 1. Executive Summary

Following the reproduction of the readiness probe failure in Module 10 STEP 5: BREAK, an isolated recovery procedure was executed to demonstrate the smallest operational fix: restoring the reachable PostgreSQL connection endpoint in the container's runtime environment.

The recovery was executed in an isolated Docker container (`bootcamp-api-fix-verify`) with complete pre-flight and post-flight safety checks:
1. **Liveness Probe (`GET /health`)**: Returned **HTTP 200 OK `{"ok":true}`** in **108ms** (internal latency: 2.92ms).
2. **Readiness Probe (`GET /ready`)**: Returned **HTTP 200 OK `{"ok":true,"status":"ready","db":"ok","redis":"ok"}`** in **129ms** (internal latency: 42.54ms).
3. **Readiness Subpath Alias (`GET /health/ready`)**: Returned **HTTP 200 OK `{"ok":true,"status":"ready","db":"ok","redis":"ok"}`** in **114ms** (internal latency: 11.71ms).
4. **Zero Code Changes**: The application code remained unmodified; the remediation was purely operational (restoring valid runtime connection routing).
5. **Strict Isolation Maintained**: The development database (`upsk_sdf`) and Redis DB 0 were verified completely untouched (zero row or key mutations). Ephemeral test containers were 100% removed.
6. **Execution History Reconciled**: Three preliminary manual shell attempts exited with code 1 due to expected diagnostic behavior (no active TCP listeners on free port 3127) and PowerShell quote parsing syntax errors in inline `node -e` commands. The recovery was then cleanly executed via the dedicated TypeScript verification script (`verify-module-10-fix.ts`), which achieved **15/15 passed checks and exit code 0**.

---

## 2. Exact Commands Executed

### 2.1 Pre-Flight Environment Checks
- **PostgreSQL Connectivity Check**:
  ```typescript
  const testPrisma = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres:postgres@localhost:5432/upsk_sdf_test?schema=public' } } });
  const dbRes = await testPrisma.$queryRaw`SELECT current_database() as db`;
  // Result: Database verified as upsk_sdf_test
  ```
- **Redis DB 1 Connectivity Check**:
  ```typescript
  const testRedis = new Redis('redis://localhost:6379/1');
  const pong = await testRedis.ping();
  // Result: PING -> PONG
  ```
- **Port 3127 & Container Name Availability Check**:
  ```bash
  docker ps -a --filter name=bootcamp-api-fix-verify
  ```

### 2.2 Container Launch Command
```bash
docker run -d --name bootcamp-api-fix-verify \
  --add-host=host.docker.internal:host-gateway \
  -p 3127:3000 \
  -e PORT=3000 -e NODE_ENV=test \
  -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/upsk_sdf_test?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379/1" \
  -e JWT_SECRET="super-secret-key-that-is-at-least-32-chars-long!" \
  bootcamp-api
```

### 2.3 Probe Commands
```bash
curl.exe -i -s "http://127.0.0.1:3127/health"
curl.exe -i -s "http://127.0.0.1:3127/ready"
curl.exe -i -s "http://127.0.0.1:3127/health/ready"
```

### 2.4 Container Logs Command
```bash
docker logs bootcamp-api-fix-verify 2>&1
```

### 2.5 Cleanup Commands
```bash
docker stop bootcamp-api-fix-verify
docker rm bootcamp-api-fix-verify
```

---

## 3. Actual HTTP Status Codes and Response Bodies

### 3.1 `GET /health` (Liveness Probe)
- **Status Code**: `HTTP/1.1 200 OK`
- **Elapsed Time**: `108ms` (internal request latency: `2.92ms`)
- **Raw Response**:
  ```http
  HTTP/1.1 200 OK
  X-Powered-By: Express
  X-Request-Id: req_4c30d8e8a4bd36924969b0bf
  Content-Type: application/json; charset=utf-8
  Content-Length: 11
  ETag: W/"b-Ai2R8hgEarLmHKwesT1qcY913ys"
  Date: Fri, 13 Nov 2026 13:32:06 GMT
  Connection: keep-alive
  Keep-Alive: timeout=5

  {"ok":true}
  ```

### 3.2 `GET /ready` (Readiness Probe)
- **Status Code**: `HTTP/1.1 200 OK`
- **Elapsed Time**: `129ms` (internal request latency: `42.54ms`)
- **Raw Response**:
  ```http
  HTTP/1.1 200 OK
  X-Powered-By: Express
  X-Request-Id: req_a5c7a978b51239ee06abdf1a
  Content-Type: application/json; charset=utf-8
  Content-Length: 51
  ETag: W/"33-Hq/JuhG30dWbqw8rHiy0wNYWTos"
  Date: Fri, 13 Nov 2026 13:32:06 GMT
  Connection: keep-alive
  Keep-Alive: timeout=5

  {"ok":true,"status":"ready","db":"ok","redis":"ok"}
  ```

### 3.3 `GET /health/ready` (Subpath Alias)
- **Status Code**: `HTTP/1.1 200 OK`
- **Elapsed Time**: `114ms` (internal request latency: `11.71ms`)
- **Raw Response**:
  ```http
  HTTP/1.1 200 OK
  X-Powered-By: Express
  X-Request-Id: req_353808f041f366632339a4cc
  Content-Type: application/json; charset=utf-8
  Content-Length: 51
  ETag: W/"33-Hq/JuhG30dWbqw8rHiy0wNYWTos"
  Date: Fri, 13 Nov 2026 13:32:07 GMT
  Connection: keep-alive
  Keep-Alive: timeout=5

  {"ok":true,"status":"ready","db":"ok","redis":"ok"}
  ```

---

## 4. PostgreSQL and Redis Connectivity Evidence

| Component | Target URL / Address | Observed Status | Evidence |
| :--- | :--- | :--- | :--- |
| **PostgreSQL Host & Port** | `host.docker.internal:5432` | **Reachable** | Container log `db_connected`, `/ready` reports `"db":"ok"` |
| **PostgreSQL Database** | `upsk_sdf_test` | **Verified** | Query `SELECT current_database()` returned `upsk_sdf_test` |
| **Redis Broker** | `host.docker.internal:6379/1` | **Reachable** | Container log `redis_connected`, `/ready` reports `"redis":"ok"` |
| **BullMQ Queue Connection** | `host.docker.internal:6379/1` | **Reachable** | Container log `analytics_queue_redis_ready` |

---

## 5. Captured Container Logs

```json
{"timestamp":"2026-11-13T13:32:05.943Z","level":"info","context":"AnalyticsQueueService","event":"analytics_queue_redis_ready","status":"ok"}
{"timestamp":"2026-11-13T13:32:06.410Z","level":"info","context":"PrismaService","event":"db_connected","status":"ok"}
{"timestamp":"2026-11-13T13:32:06.430Z","level":"info","context":"RedisCacheService","event":"redis_connected","status":"ok"}
{"timestamp":"2026-11-13T13:32:06.440Z","level":"info","context":"NestFactory","message":"Starting Nest application..."}
{"timestamp":"2026-11-13T13:32:06.440Z","level":"info","context":"InstanceLoader","message":"LoggingModule dependencies initialized"}
{"timestamp":"2026-11-13T13:32:06.440Z","level":"info","context":"InstanceLoader","message":"ThrottlerModule dependencies initialized"}
{"timestamp":"2026-11-13T13:32:06.440Z","level":"info","context":"JwtModule dependencies initialized"}
{"timestamp":"2026-11-13T13:32:06.441Z","level":"info","context":"InstanceLoader","message":"CacheModule dependencies initialized"}
{"timestamp":"2026-11-13T13:32:06.441Z","level":"info","context":"InstanceLoader","message":"PrismaModule dependencies initialized"}
{"timestamp":"2026-11-13T13:32:06.441Z","level":"info","context":"InstanceLoader","message":"AppModule dependencies initialized"}
{"timestamp":"2026-11-13T13:32:06.441Z","level":"info","context":"InstanceLoader","message":"HealthModule dependencies initialized"}
{"timestamp":"2026-11-13T13:32:06.441Z","level":"info","context":"InstanceLoader","message":"AnalyticsModule dependencies initialized"}
{"timestamp":"2026-11-13T13:32:06.441Z","level":"info","context":"InstanceLoader","message":"AuthModule dependencies initialized"}
{"timestamp":"2026-11-13T13:32:06.441Z","level":"info","context":"InstanceLoader","message":"LinksModule dependencies initialized"}
{"timestamp":"2026-11-13T13:32:06.441Z","level":"info","context":"RoutesResolver","message":"HealthController {/}:"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RouterExplorer","message":"Mapped {/health, GET} route"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RouterExplorer","message":"Mapped {/ready, GET} route"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RouterExplorer","message":"Mapped {/health/ready, GET} route"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RoutesResolver","message":"AuthController {/auth}:"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RouterExplorer","message":"Mapped {/auth/login, POST} route"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RoutesResolver","message":"LinksController {/links}:"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RouterExplorer","message":"Mapped {/links, POST} route"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RouterExplorer","message":"Mapped {/links, GET} route"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RouterExplorer","message":"Mapped {/links/search, GET} route"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RouterExplorer","message":"Mapped {/links/:id/analytics, GET} route"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RouterExplorer","message":"Mapped {/links/:id, GET} route"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RouterExplorer","message":"Mapped {/links/:id, PATCH} route"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RouterExplorer","message":"Mapped {/links/:id, DELETE} route"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RoutesResolver","message":"RedirectController {/r}:"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"RouterExplorer","message":"Mapped {/r/:code, GET} route"}
{"timestamp":"2026-11-13T13:32:06.442Z","level":"info","context":"NestApplication","message":"Nest application successfully started"}
{"timestamp":"2026-11-13T13:32:06.443Z","level":"info","context":"Bootstrap","event":"server_started","port":3000,"host":"[REDACTED_IP]"}
{"timestamp":"2026-11-13T13:32:06.809Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_a5c7a978b51239ee06abdf1a","method":"GET","route":"/ready","status_code":200,"latency_ms":42.54}
{"timestamp":"2026-11-13T13:32:06.921Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_4c30d8e8a4bd36924969b0bf","method":"GET","route":"/health","status_code":200,"latency_ms":2.92}
{"timestamp":"2026-11-13T13:32:07.040Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_353808f041f366632339a4cc","method":"GET","route":"/health/ready","status_code":200,"latency_ms":11.71}
```

---

## 6. Cleanup & Isolation Verification

### 6.1 Docker Container Cleanup
- `docker stop bootcamp-api-fix-verify` and `docker rm bootcamp-api-fix-verify` completed successfully.
- `docker ps -a --filter name=bootcamp-api-fix-verify` returned:
  ```text
  CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
  ```
  **0 active or residual test containers remain.**

### 6.2 Development Database & Redis DB 0 Integrity
- **PostgreSQL Development Database (`upsk_sdf`)**:
  - Initial row count: `25 links`, `0 click events`.
  - Final row count: `25 links`, `0 click events`.
  - **Verdict**: Completely untouched (0 mutations).
- **Redis Development Database (DB 0)**:
  - Initial key count: `188 keys`.
  - Final key count: `188 keys`.
  - **Verdict**: Completely untouched (0 mutations).

### 6.3 Application Code & Configuration Integrity
- `api/src/`: Zero files modified.
- `prisma/`: Zero migrations run; schema untouched.
- `.env`: Untouched.
- `.github/workflows/`: Untouched.
- `progress/state.json`: Untouched.

---

## 7. Execution History, Preliminary Non-Zero Exits, and Final Verification

### 7.1 Preliminary Commands Exiting With Code 1
Prior to executing the automated TypeScript recovery script, three preliminary manual shell commands returned exit code 1 during pre-flight diagnostics. These were thoroughly investigated:

#### Attempt 1: Port 3127 and Container Name Availability Check
- **Exact Command**:
  ```powershell
  powershell -Command "docker ps -a --filter name=bootcamp-api-fix-verify; Get-NetTCPConnection -LocalPort 3127 -ErrorAction SilentlyContinue"
  ```
- **Exit Code**: `1`
- **Captured Stdout**:
  ```text
  CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
  ```
- **Captured Stderr**: Suppressed by `-ErrorAction SilentlyContinue`.
- **Classification & Root Cause**: **Expected Diagnostic Outcome**.
  - `docker ps -a` succeeded and confirmed zero containers named `bootcamp-api-fix-verify` existed.
  - In PowerShell, `Get-NetTCPConnection -LocalPort 3127` queries active TCP connections on local port 3127. Because no process was listening on port 3127 (which was the desired pre-condition for running the container), `Get-NetTCPConnection` threw a non-terminating error indicating no matches were found. Even with `-ErrorAction SilentlyContinue`, PowerShell sets `$LASTEXITCODE` / process exit code to 1 when a cmdlet completes without returning any object. The exit code reflected that port 3127 was completely free and available, but produced a non-zero exit code.

#### Attempt 2: Direct PostgreSQL Verification via `node -e` with `pg`
- **Exact Command**:
  ```powershell
  powershell -Command "node -e 'const { Client } = require(\"D:/Knack labs/api/node_modules/pg\"); (async () => { const client = new Client({ connectionString: \"postgresql://postgres:postgres@localhost:5432/upsk_sdf_test\" }); await client.connect(); const res = await client.query(\"SELECT current_database(), now()\"); console.log(\"PostgreSQL connected:\", res.rows[0]); await client.end(); })().catch(err => { console.error(err); process.exit(1); });'"
  ```
- **Exit Code**: `1`
- **Captured Stdout**: *(empty)*
- **Captured Stderr**:
  ```text
  At line:1 char:429
  + ... (); const res = await client.query(\"SELECT current_database(), now() ...
  +                                                                  ~
  An expression was expected after '('.
  At line:1 char:436
  + ... st res = await client.query(\"SELECT current_database(), now()\"); co ...
  +                                                                  ~
  An expression was expected after '('.
      + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException
      + FullyQualifiedErrorId : ExpectedExpression
  ```
- **Classification & Root Cause**: **Environment / Shell Syntax Error**.
  - This was not a database connection failure. Node.js was never launched.
  - When PowerShell parsed the inline `-Command` string containing embedded escaped quotes and commas (`\"SELECT current_database(), now()\"`), the PowerShell parser treated `, now()` as an argument delimiter rather than a string literal, resulting in a PowerShell parser error (`ExpectedExpression`) before invoking Node.js.

#### Attempt 3: Direct PostgreSQL Verification via `node -e` with Prisma
- **Exact Command**:
  ```powershell
  powershell -Command "node -e 'const { PrismaClient } = require(\`\"@prisma/client\`\"); const p = new PrismaClient({ datasources: { db: { url: \`\"postgresql://postgres:postgres@localhost:5432/upsk_sdf_test?schema=public\`\" } } }); p.\`$queryRaw\`\"SELECT current_database(), current_user\`\".then(r => { console.log(\`\"[PG_VERIFY_OK]\`\", r); return p.\`$disconnect\`(); }).catch(e => { console.error(e); process.exit(1); });'"
  ```
- **Exit Code**: `1`
- **Captured Stdout**: *(empty)*
- **Captured Stderr**:
  ```text
  At line:1 char:390
  + ... ema=public`\" } } }); p.`$queryRaw`\"SELECT current_database(), curre ...
  +                                                                  ~
  An expression was expected after '('.
      + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException
      + FullyQualifiedErrorId : ExpectedExpression
  ```
- **Classification & Root Cause**: **Environment / Shell Syntax Error**.
  - Identical parser issue: PowerShell's string interpolation and quote escaping rules on Windows failed to pass the backtick-escaped `$queryRaw` template string with commas to Node.js, failing at the shell parser layer with `ExpectedExpression`.

### 7.2 Resolution: Dedicated TypeScript Recovery Script
To eliminate brittle inline PowerShell string escaping, the pre-flight checks and full recovery suite were encapsulated into a dedicated, reproducible script: `api/scripts/verify-module-10-fix.ts`.

### 7.3 Final Automated Verification Results
When executed via `npx ts-node scripts/verify-module-10-fix.ts`, the script ran to completion with **exit code 0**:
- **15 passed, 0 failed**.
- Pre-flight verified PostgreSQL connectivity to `upsk_sdf_test` and Redis DB 1.
- Ephemeral recovery container booted, established full readiness, and passed all liveness (`200 OK`) and readiness (`200 OK`) checks.
- Container logs confirmed clean bootstrap with zero database connection errors.
- Container cleanup and database isolation checks confirmed 100% integrity.

---

## 8. Empirical Graceful Shutdown Drill & In-Flight Request Analysis

To close the evidence gap regarding containerized `SIGTERM` handling, an isolated empirical drill was executed using `api/scripts/drill-graceful-shutdown.ts` against the existing `bootcamp-api:latest` image on port 3128.

### 8.1 Measured Chronological Timeline
1. **T = 0ms** (`1794578809526`): Client opened TCP socket to port 3128 and transmitted `GET /ready`.
2. **T = +12ms** (`1794578809538`): `SIGTERM` was dispatched to the container via `docker stop -t 10`.
3. **T = +745ms** (`1794578810271`): Container process stopped and Docker recorded termination.
4. **T = +749ms** (`1794578810275`): Client stream received the complete HTTP response.
- **Outcome**: The request received `HTTP 200 OK` `{"ok":true,"status":"ready","db":"ok","redis":"ok"}` with **zero socket errors or `ECONNRESET`**.
- **Post-Shutdown Ingress**: Immediate subsequent requests were rejected (`ECONNREFUSED`), proving ingress traffic was stopped upon `SIGTERM`.
- **Container Exit**: Status was `exited` with exit code **`0`** in **`733ms`** stop duration.

### 8.2 Explicit Qualifications & Evidence Scope

In evaluating this drill, two important technical qualifications are preserved:

#### Qualification A: In-Flight Request Timing Precision (Iteration 1 vs Iteration 2)
- **Iteration 1**: Attempted to assert `inFlightResult.responseEndTime <= stopCompleteTime`. This failed by 5ms (`1794578810275` vs `1794578810271`) because the client stream `end` event resolved across processes 5ms after `docker stop` returned.
- **Iteration 2**: Adjusted the assertion to check that the client socket connected before `SIGTERM` was sent (`requestSocketConnectTime <= sigtermSentTime`), received `HTTP 200 OK`, and experienced zero socket errors (`socketError === null`).
- **Exact Distinction**: The evidence confirms the request was initiated and connected before `SIGTERM`, survived container termination signaling, and received a valid HTTP 200 response without socket reset. It does **not** claim the client stream completed strictly before the container process terminated.

#### Qualification B: Scope of Exit Code 0 and Connection Drops
- **PostgreSQL**: `pg_stat_activity` on `upsk_sdf_test` dropped from 2 connections before shutdown to 1 connection after shutdown (the test runner's client).
- **Redis**: Redis `CLIENT LIST` dropped from 4 clients before shutdown to 2 clients after shutdown.
- **Exact Distinction**: Container exit code 0 and connection count drops provide strong **empirical evidence of resource release and orderly process exit**. However, because `PrismaService` and `RedisCacheService` do not log on successful disconnect (only on error), this does **not** constitute direct internal confirmation that every individual NestJS provider shutdown hook executed to completion. The limitation in stdout logging is explicitly acknowledged.

Full raw output is preserved in [graceful-shutdown-drill.txt](file:///D:/Knack%20labs/progress/evidence/module-10/graceful-shutdown-drill.txt).

