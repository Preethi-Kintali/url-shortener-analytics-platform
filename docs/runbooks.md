# Production Incident Runbooks (Hardened & Verified)

---

# Runbook 1: PostgreSQL Connection Pool Exhaustion & Database Outage

### Alert / Detection
- **Alert Name:** `HighErrorRate` / `DatabaseDown`
- **Symptoms:**
  - Ingress HTTP 500 error rate exceeds 5% for >2 minutes.
  - End-users receive HTTP 503 (`TEMPORARY_UNAVAILABLE`) on uncached short links and link creation.
  - Dashboard shows spike in `http_requests_total{status="500"}` or `status="503"`.
- **Primary Signal:** `/ready` probe returns HTTP 503 `{"ok":false,"status":"degraded","checks":{"database":"disconnected"}}`.

### Diagnosis

#### Step 1: Inspect Container Health & Application Error Logs
```powershell
$CID = docker ps -q --filter "name=myservice" | Select-Object -First 1; if ($CID) { docker logs --since 5m --tail 50 $CID } else { docker logs --since 5m --tail 50 myservice-prod }
```
- **If this IS the problem, you will see:**
  `{"level":"ERROR","event":"all_exceptions_caught","error":{"name":"PrismaClientInitializationError","message":"Can't reach database server at localhost:5432"}}`
  OR
  `{"level":"ERROR","event":"circuit_opened","dependency":"database","status":"open"}`
- **If this is NOT the problem, you will see:**
  Normal HTTP request logs with `"statusCode":200` or `"statusCode":302` and zero Prisma connection error strings.

#### Step 2: Check PostgreSQL Container & Listening Port
```powershell
docker ps -a --filter "name=upsk-sdf-postgres" --format "{{.Names}}: {{.Status}}"
```
- **If this IS the problem, you will see:**
  `upsk-sdf-postgres: Exited (N)` OR container status showing `Restarting`.
- **If this is NOT the problem, you will see:**
  `upsk-sdf-postgres: Up X minutes (healthy)`

### Fix

#### Step 1: Start / Restart PostgreSQL Container
```powershell
docker start upsk-sdf-postgres
```
- **Expected Output:**
  `upsk-sdf-postgres`
- *If this does NOT start the container, inspect daemon logs:*
  `docker logs upsk-sdf-postgres --tail 30`

#### Step 2: Confirm Port 5432 Connectivity (Socket Binding Verification)
```powershell
Test-NetConnection -ComputerName localhost -Port 5432 | Select-Object ComputerName, RemotePort, TcpTestSucceeded
```
- **Expected Output:**
  `TcpTestSucceeded : True`

### Verification (With Socket Stabilization & Polling)

#### Step 1: Verify Deep Readiness Probe (Allow 3-second Socket Stabilization)
```powershell
$PORT = if ($env:PORT) { $env:PORT } else { "3000" }
Start-Sleep -Seconds 3
for ($i=1; $i -le 5; $i++) {
  $res = curl -s http://localhost:$PORT/ready
  if ($res -match '"ok":true') { Write-Output "Recovered: $res"; break }
  Start-Sleep -Seconds 2
}
```
- **Expected Output:**
  `Recovered: {"ok":true,"status":"ok","checks":{"database":"connected","cache":"connected"}}`

#### Step 2: Probe Circuit Breaker Recovery
```powershell
$PORT = if ($env:PORT) { $env:PORT } else { "3000" }
curl -s http://localhost:$PORT/live
```
- **Expected Output:**
  `{"ok":true}`. Wait 2 minutes and repeat `/ready` to confirm circuit transitioned from `HALF-OPEN` to `CLOSED`.

### Escalation
If PostgreSQL fails to recover within **10 minutes**:
1. Post summary in `#ops-url-shortener` with output from `docker logs upsk-sdf-postgres --tail 50`.
2. Page Database Reliability Lead via PagerDuty: `dba-oncall-p1`.
3. If unacknowledged within 5 minutes, escalate to Engineering Manager (Phone / PagerDuty P1).

---

# Runbook 2: Redis Partition & Cache Degradation

### Alert / Detection
- **Alert Name:** `HighLatency` / `RedisUnavailable`
- **Symptoms:**
  - Latency P95 on `GET /r/:code` jumps from <10ms to >80ms as requests fall back to PostgreSQL.
  - Analytics events are not appearing in real-time dashboards.
- **Primary Signal:** Application logs show repeated `redis_client_error` or `redis_config_invalid`.

### Diagnosis

#### Step 1: Inspect Redis Client Logs in Application Container
```powershell
$CID = docker ps -q --filter "name=myservice" | Select-Object -First 1; if ($CID) { docker logs --since 5m --tail 50 $CID | Select-String "redis" } else { Write-Output "No active container" }
```
- **If this IS the problem, you will see:**
  `{"level":"WARN","event":"redis_client_error","status":"degraded","reason":"connect ECONNREFUSED 127.0.0.1:6379"}`
- **If this is NOT the problem, you will see:**
  `{"level":"INFO","event":"redis_connected","status":"ok"}`

#### Step 2: Check Redis Container Status
```powershell
docker ps -a --filter "name=bootcamp-redis" --format "{{.Names}}: {{.Status}}"
```
- **If this IS the problem, you will see:**
  `bootcamp-redis: Exited (N)` OR container missing from process table.
- **If this is NOT the problem, you will see:**
  `bootcamp-redis: Up X hours`

### Fix

#### Step 1: Restart Redis Container
```powershell
docker restart bootcamp-redis
```
- **Expected Output:**
  `bootcamp-redis`

#### Step 2: Ping Redis Directly
```powershell
docker exec bootcamp-redis redis-cli ping
```
- **Expected Output:**
  `PONG`

### Verification

#### Step 1: Check Application Reconnection
```powershell
$CID = docker ps -q --filter "name=myservice" | Select-Object -First 1; docker logs --since 1m $CID | Select-String "redis_connected"
```
- **Expected Output:**
  `{"level":"INFO","event":"redis_connected","status":"ok"}`

#### Step 2: Test URL Redirection Performance
```powershell
$PORT = if ($env:PORT) { $env:PORT } else { "3000" }
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" http://localhost:$PORT/r/healthcheck
```
- **Expected Output:**
  HTTP 302 response with latency $< 0.020\text{s}$ (served from cache).

### Escalation
If Redis cannot be recovered within **15 minutes**:
1. Post status in `#ops-url-shortener`: *"Redis partitioned; URL redirection operating in degraded database fallback mode"*.
2. Page Cache Infrastructure Specialist: `cache-infra-p1`.

---

# Runbook 3: High Latency & Cascading Circuit Breaker Flapping

### Alert / Detection
- **Alert Name:** `HighLatency` / `ServiceDown`
- **Symptoms:**
  - Prometheus alert `HighLatency` fires (P95 latency $> 500\text{ms}$ for $>5$ minutes).
  - Users report sporadic slow responses followed by immediate 503 degraded pages.
- **Primary Signal:** Application logs exhibit alternating `circuit_opened` and `circuit_half_open` events.

### Diagnosis

#### Step 1: Check Ingress Latency Distribution & Active Metrics
```powershell
$PORT = if ($env:PORT) { $env:PORT } else { "3000" }
curl -s http://localhost:$PORT/metrics | Select-String "http_request_duration_seconds"
```
- **If this IS the problem, you will see:**
  Bucket `http_request_duration_seconds_bucket{le="1"} < total`, showing significant requests taking $>1\text{s}$.
- **If this is NOT the problem, you will see:**
  $99\%$ of requests contained in the `le="0.1"` (100ms) bucket.

#### Step 2: Inspect Database Slow Queries & Connection Saturation
```powershell
docker exec upsk-sdf-postgres psql -U postgres -d upsk_sdf -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"
```
- **If this IS the problem, you will see:**
  High connection counts in `active` state with query runtimes exceeding 2,000ms.
- **If this is NOT the problem, you will see:**
  Most connections in `idle` state; total connections well below the 100 max limit.

### Fix

#### Step 1: Terminate Stalled Long-Running PostgreSQL Queries
```powershell
docker exec upsk-sdf-postgres psql -U postgres -d upsk_sdf -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'active' AND query_start < NOW() - INTERVAL '5 seconds' AND pid <> pg_backend_pid();"
```
- **Expected Output:**
  List of terminated query PIDs, immediately freeing PostgreSQL connection slots.

#### Step 2: Reset Singleflight and Clear Flapping Circuit Breakers
```powershell
docker exec bootcamp-redis redis-cli FLUSHDB
```
- **Expected Output:**
  `OK` (Clears corrupted/stale keys, resetting cache to cold state without downtime).

### Verification

#### Step 1: Confirm Connection Pool Drained
```powershell
docker exec upsk-sdf-postgres psql -U postgres -d upsk_sdf -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';"
```
- **Expected Output:**
  Count $\le 3$.

#### Step 2: Verify Endpoint Latency Returns to Sub-50ms Baseline
```powershell
$PORT = if ($env:PORT) { $env:PORT } else { "3000" }
curl -s -w "HTTP: %{http_code} | Total: %{time_total}s\n" http://localhost:$PORT/live
```
- **Expected Output:**
  `HTTP: 200 | Total: 0.005s`

### Escalation
If latency remains above 500ms after query termination:
1. Notify `#ops-url-shortener` of active performance degradation.
2. Page Senior Backend On-Call and Database Administrator.

---

# Runbook 4: Silent Business Degradation (Readiness 200, Business 5xx)

### Alert / Detection
- **Alert Name:** `SyntheticSmokeTestFailed` / `BusinessEndpointHigh5xx`
- **Symptoms:**
  - `GET /ready` returns HTTP 200 `{"ok":true,"checks":{"database":"connected","cache":"connected"}}`.
  - Business endpoints (`POST /links`, `GET /:code`) return HTTP 500 or 401.
  - End-users receive error toasts while platform status shows all green.
- **Primary Signal:** Synthetic smoke test alert fires or customer error reports spike immediately following a release.

### Diagnosis

#### Step 1: Execute Synthetic End-to-End Smoke Test
```powershell
$PORT = if ($env:PORT) { $env:PORT } else { "3000" }
curl -s -X POST http://localhost:$PORT/links -H "Content-Type: application/json" -d '{"longUrl":"https://example.com/smoke-test","createdBy":"ops-smoke"}'
```
- **If this IS the problem, you will see:**
  `{"statusCode":500,"message":"Internal server error"}` OR `{"statusCode":401,"message":"Unauthorized"}`
- **If this is NOT the problem, you will see:**
  `{"code":"...","longUrl":"https://example.com/smoke-test","createdBy":"ops-smoke"}`

#### Step 2: Check Prisma Database Migration Status
```powershell
$CID = docker ps -q --filter "name=linkops-prod-verify" | Select-Object -First 1
if ($CID) { docker exec $CID npx prisma migrate status } else { cd "D:\Knack labs\api"; npx prisma migrate status }
```
- **If this IS the problem, you will see:**
  `Following migration have not yet been applied:` OR `Database schema is not up to date.`
- **If this is NOT the problem, you will see:**
  `Database schema is up to date!`

### Fix

#### Step 1: Apply Pending Schema Migrations
```powershell
$CID = docker ps -q --filter "name=linkops-prod-verify" | Select-Object -First 1
if ($CID) { docker exec $CID npx prisma migrate deploy } else { cd "D:\Knack labs\api"; npx prisma migrate deploy }
```
- **Expected Output:**
  `No pending migrations to apply.` OR `X migrations applied successfully.`

#### Step 2: Trigger Emergency Rollback if Bug is in Application Code
If migrations are applied but business logic throws errors, roll back to prior known-good SHA:
```powershell
docker stop linkops-prod-verify; docker rm linkops-prod-verify
docker run -d --name linkops-prod-verify -p 3000:3000 --add-host=host.docker.internal:host-gateway -e NODE_ENV=production -e APP_ENV=production -e PORT=3000 -e CORS_ORIGIN=http://localhost:3000 -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/upsk_sdf?schema=public -e REDIS_URL=redis://host.docker.internal:6379 -e JWT_SECRET=production-readiness-secret-key-at-least-32-chars! -e LOG_LEVEL=info myservice:2fb26c6
```
- **Expected Output:**
  Container ID of restored known-good container.

### Verification
```powershell
$PORT = if ($env:PORT) { $env:PORT } else { "3000" }
curl -s -X POST http://localhost:$PORT/links -H "Content-Type: application/json" -d '{"longUrl":"https://example.com/smoke-verify","createdBy":"ops-verify"}'
```
- **Expected Output:**
  `{"code":"...","longUrl":"https://example.com/smoke-verify","createdBy":"ops-verify"}` (HTTP 201 Created).

---

# Runbook 5: Node.js Memory Creep & Unbounded Heap Saturation

### Alert / Detection
- **Alert Name:** `HighMemoryUsage` / `MemorySaturationWarning`
- **Symptoms:**
  - `process_resident_memory_bytes` exceeds 400MB or shows continuous upward slope for >30m.
  - Event loop lag (`nodejs_eventloop_lag_seconds`) rises above 50ms.
  - Periodic latency spikes occur due to heavy Garbage Collection pauses.
- **Primary Signal:** Memory usage metric continuously approaches container memory threshold (512MB).

### Diagnosis

#### Step 1: Inspect Process Resident Set Size (RSS) and Heap Usage
```powershell
$PORT = if ($env:PORT) { $env:PORT } else { "3000" }
curl -s http://localhost:$PORT/metrics | Select-String "process_resident_memory_bytes|nodejs_heap_size_used_bytes"
```
- **If this IS the problem, you will see:**
  `process_resident_memory_bytes` value exceeding 400000000 (400MB).
- **If this is NOT the problem, you will see:**
  `process_resident_memory_bytes` stabilized between 100MB and 250MB.

#### Step 2: Check for High Garbage Collection Pause Times
```powershell
$PORT = if ($env:PORT) { $env:PORT } else { "3000" }
curl -s http://localhost:$PORT/metrics | Select-String "nodejs_eventloop_lag_seconds"
```
- **If this IS the problem, you will see:**
  Lag values $\ge 0.05$ (50ms).

### Fix

#### Step 1: Rolling Restart to Mitigate Immediate OOM Risk
```powershell
docker restart linkops-prod-verify
```
- **Expected Output:**
  `linkops-prod-verify`

#### Step 2: Trigger Rollback if Caused by Recent Release
If memory growth resumed immediately post-deployment, roll back to the previous stable release commit SHA.

### Verification
```powershell
$PORT = if ($env:PORT) { $env:PORT } else { "3000" }
Start-Sleep -Seconds 5
curl -s http://localhost:$PORT/metrics | Select-String "process_resident_memory_bytes"
```
- **Expected Output:**
  `process_resident_memory_bytes < 150000000` (150MB baseline).

---

# Runbook 6: Out-of-Band Configuration Drift Remediation

### Alert / Detection
- **Alert Name:** `ConfigDriftDetected`
- **Symptoms:**
  - Container behaves differently from staging/test environments.
  - Database pool size, timeouts, or API credentials mismatch repository declarations.
- **Primary Signal:** CI drift audit script or manual diff flags discrepancy between running container environment and canonical `.env.production` / CI secrets.

### Diagnosis

#### Step 1: Compare Running Container Environment Against Declared Spec
```powershell
$CID = docker ps -q --filter "name=linkops-prod-verify" | Select-Object -First 1
docker exec $CID env | Select-String "DATABASE_URL|REDIS_URL|PORT|NODE_ENV|JWT_SECRET|CORS_ORIGIN"
```
- **If this IS the problem, you will see:**
  An environment variable value that was modified directly via docker or platform console instead of CI/CD.
- **If this is NOT the problem, you will see:**
  Environment variables match Git-versioned manifest exactly.

### Fix

#### Step 1: Re-align Running Container with CI-Declared Secrets
```powershell
docker stop linkops-prod-verify; docker rm linkops-prod-verify
docker run -d --name linkops-prod-verify -p 3000:3000 --add-host=host.docker.internal:host-gateway -e NODE_ENV=production -e APP_ENV=production -e PORT=3000 -e CORS_ORIGIN=http://localhost:3000 -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/upsk_sdf?schema=public -e REDIS_URL=redis://host.docker.internal:6379 -e JWT_SECRET=production-readiness-secret-key-at-least-32-chars! -e LOG_LEVEL=info myservice:2fb26c6
```
- **Expected Output:**
  Container started with canonical configuration.

#### Step 2: Commit Emergency Changes to Git
If the manual configuration change was a necessary fix, immediately create a Git pull request to make it permanent in version control.

### Verification
```powershell
$PORT = if ($env:PORT) { $env:PORT } else { "3000" }
curl -s http://localhost:$PORT/ready
```
- **Expected Output:**
  `{"ok":true,"checks":{"database":"connected","cache":"connected"}}` (HTTP 200).
