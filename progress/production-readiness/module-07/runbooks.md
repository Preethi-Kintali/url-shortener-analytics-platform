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
