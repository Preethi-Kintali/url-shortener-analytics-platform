# OrderFlow Operational Runbook: 3 AM Incident Response

**Service:** OrderFlow (E-Commerce Order Processing Service)  
**Primary Language/Runtime:** Python (FastAPI) on Port `8080`  
**Target Namespace:** `production`  
**Escalation Policy:** PagerDuty `OrderFlow Primary` | Slack: `#orderflow-oncall`  
**Documentation Status:** Authoritative In-Repository Runbook  

> **OPERATIONAL SAFETY PRINCIPLE:**  
> Prioritize system safety and data integrity over recovery speed. Never guess commands, credentials, or resource names. Clearly verify environment-specific configurations before executing state-changing operations.

---

## 1. Incident Overview & Quick Reference

OrderFlow handles the order lifecycle from checkout creation to asynchronous refund processing.

### Confirmed Architecture & Components
- **Core API Service:** FastAPI application listening on port `8080` for order creation, status checks, payment processing, and refund requests. Authenticates via Bearer tokens.
- **Primary Database:** PostgreSQL 15 on port `5432`. Connection string configured via `DATABASE_URL`. Schema migrations managed via Alembic.
- **Cache & Rate Limiting:** Redis 7 on port `6379`. Connection string configured via `REDIS_URL`. If Redis is unavailable, the API continues operating in degraded/unthrottled mode (slower response times and rate limiting disabled).
- **Background Worker:** Celery worker processing refund tasks asynchronously from a Redis queue. Initialized via `celery -A orderflow.worker worker --loglevel=info`. Queue connection configured via `CELERY_BROKER_URL`.
- **Deployment Platform:** Kubernetes managed via Helm charts in `deploy/`. Confirmed rollback command: `helm rollback orderflow --namespace production`.

### Environment Variables
#### Confirmed Core Variables
| Variable Name | Purpose | Confirmed Scope |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | Confirmed required for database access |
| `REDIS_URL` | Redis connection string (cache & rate limiter) | Confirmed required for caching & throttling |
| `CELERY_BROKER_URL` | Celery broker queue connection (Redis) | Confirmed required for refund processing queue |

#### Additional Variables *(Verify in production configuration before relying on values)*
*Note: The following variables are commonly configured for this service architecture but must be verified against deployment manifests:*  
`AUTH_SERVICE_URL`, `STRIPE_API_KEY`, `SENTRY_DSN`, `PORT`, `LOG_LEVEL`.

### Confirmed Team Escalation Contacts
- **Primary On-Call Rotation:** Slack `#orderflow-oncall` / PagerDuty `OrderFlow Primary`
- **Database Support:** Slack `#data-eng`
- **Platform & Deployment Support:** Slack `#platform-infra`

---

## 2. Initial Health & Diagnostic Checks (Triage within 3 Minutes)

Execute these checks from an authorized administrative workstation with cluster access.

### Step 2.1: Discover Workload & Confirm Pod Resource Names
Before restarting or inspecting pods, run the discovery command to obtain active resource names:
```bash
# Discovery command: List deployments and pods in the production namespace
kubectl get deployments -n production
kubectl get pods -n production -o wide
```
- **Instructions:** Locate the exact pod names for the OrderFlow API (e.g. `orderflow-xxx`) and worker. Substitute these confirmed names into subsequent commands.
- **Expected Outcome:** Workloads show status `Running` with `1/1` ready and low restart counts.
- **Stopping Condition:** If pods show `CrashLoopBackOff` or `Error`, inspect recent logs before restarting:
  ```bash
  kubectl logs -n production [confirmed-pod-name] --tail=100
  ```

### Step 2.2: Probe API Health Endpoint *(Requires Route Verification)*
*Verify whether the service exposes `/health`, `/api/v1/health`, or a status route in the codebase:*
```bash
# Illustrative probe (verify exact health route in service route definitions)
curl -i -s --max-time 5 http://[confirmed-service-host]:8080/health
```
- **Expected Outcome:** HTTP 200 OK indicating the API process is responding.
- **Stopping Condition:** If connection times out or returns HTTP 5xx, proceed to Section 3.1.

### Step 2.3: Verify PostgreSQL Connectivity
Run this Python probe inside an active OrderFlow pod to verify database reachability and clean connection closing:
```bash
kubectl exec -it -n production [confirmed-orderflow-pod-name] -- python -c "import os, psycopg2; db_url = os.environ.get('DATABASE_URL'); assert db_url, 'DATABASE_URL not set'; conn = psycopg2.connect(db_url); cur = conn.cursor(); cur.execute('SELECT 1'); print('Database connectivity verified:', cur.fetchone()); cur.close(); conn.close()"
```
- **Expected Outcome:** `Database connectivity verified: (1,)`.
- **Stopping Condition:** If connection fails (`Connection refused`, `timeout`, or authentication error), proceed to Section 4.1.

### Step 2.4: Verify Redis Connectivity
Run this Python probe inside an active OrderFlow pod to verify cache reachability:
```bash
kubectl exec -it -n production [confirmed-orderflow-pod-name] -- python -c "import os, redis; redis_url = os.environ.get('REDIS_URL'); assert redis_url, 'REDIS_URL not set'; r = redis.Redis.from_url(redis_url); print('Redis Ping:', r.ping())"
```
- **Expected Outcome:** `Redis Ping: True`.
- **Stopping Condition:** If Redis fails, note that API operates in degraded/unthrottled mode. Proceed to Section 4.2.

### Step 2.5: Verify Celery Refund Worker Activity
```bash
# Confirmed worker process command pattern: inspect active nodes
kubectl exec -it -n production [confirmed-worker-pod-name] -- celery -A orderflow.worker inspect ping
```
- **Expected Outcome:** Response from worker confirming `OK`.
- **Stopping Condition:** If worker does not respond or refunds are stalled, proceed to Section 4.3.

---

## 3. Diagnostic Decision Trees

### 3.1: Elevated HTTP 5xx Errors or Complete Service Unavailability
1. **Check Deployment Recency:** Was a release deployed recently?
   - **If YES (deployed within incident window):** Proceed to **Section 5 (Deployment Rollback)**.
   - **If NO:** Proceed to Step 2.
2. **Check Database Connectivity:** Execute Step 2.3.
   - **If database fails:** Proceed to **Section 4.1 (PostgreSQL Recovery)**.
   - **If database succeeds:** Inspect application logs for unhandled exceptions:
     ```bash
     kubectl logs -n production [confirmed-orderflow-pod-name] --tail=200
     ```

### 3.2: Missing Database Tables or Migration Errors
- **Condition:** Logs display `relation does not exist` or schema errors.
- **SAFE STOPPING DIRECTIVE:** **Do NOT run `alembic upgrade head` directly as an ad-hoc emergency action.** Database migrations alter persistent schema state and must follow the controlled deployment procedure. Escalate immediately to `#data-eng` to coordinate schema status review.

### 3.3: Stalled Refund Processing
- **Condition:** Customers report unfulfilled refunds; API endpoints accept requests, but refunds do not complete.
- **Diagnostic Step:** Verify whether Celery worker process is running and whether Redis broker queue is accumulating items.
- **Action:** Proceed to **Section 4.3 (Celery Worker Diagnostics & Safe Restart)**.

---

## 4. Recovery Procedures

### 4.1: PostgreSQL Connection Failure
- **Symptom:** API returns 500/503; Step 2.3 fails with `OperationalError: could not connect to server`.
- **Diagnostic Command:** Inspect active connection state (read-only):
  ```bash
  kubectl exec -it -n production [confirmed-orderflow-pod-name] -- python -c "import os, psycopg2; db_url = os.environ.get('DATABASE_URL'); assert db_url, 'DATABASE_URL not set'; conn = psycopg2.connect(db_url); cur = conn.cursor(); cur.execute('SELECT count(*), state FROM pg_stat_activity GROUP BY state;'); print(cur.fetchall()); cur.close(); conn.close()"
  ```
- **Expected Result:** Summary of active and idle connections across PostgreSQL worker backends.
- **SAFETY CONTROL & Approval Condition:**
  - **Do NOT terminate database sessions unilaterally.** Terminating active transactions without DBA approval can abort valid customer checkouts or cause transaction state inconsistencies.
  - If connections are saturated or blocked, capture the connection count output and contact `#data-eng` on Slack.
- **Recovery Steps:**
  1. If connection counts show zombie pools and `#data-eng` confirms application-side restart is safe, restart API pods:
     ```bash
     kubectl rollout restart deployment/[confirmed-orderflow-deployment-name] -n production
     kubectl rollout status deployment/[confirmed-orderflow-deployment-name] -n production
     ```
- **Post-Recovery Verification:** Re-run Step 2.3 (`SELECT 1`). Verify connection succeeds.
- **Escalation Condition:** If database connectivity is not restored within team-policy SLA, escalate immediately to `#data-eng`.

### 4.2: Redis Failure & Degraded Mode Assessment
- **Symptom:** Step 2.4 fails with connection timeout; API latency increases; rate limiting stops.
- **Diagnostic Step:** Confirm that API is operating in degraded/unthrottled mode per design:
  - Ingestion and checkout remain operational in degraded mode (direct DB lookups).
  - Rate limiting is paused.
- **Recovery Steps:**
  1. Discover Redis pod and controller name:
     ```bash
     kubectl get pods -n production -l [confirmed-redis-selector]
     ```
  2. Inspect logs:
     ```bash
     kubectl logs -n production [confirmed-redis-pod-name] --tail=50
     ```
  3. Once confirmed, perform rolling restart of the Redis controller:
     ```bash
     kubectl rollout restart [deployment-or-statefulset]/[confirmed-redis-name] -n production
     ```
- **Post-Recovery Verification:** Re-run Step 2.4. Verify `Redis Ping: True`.
- **Escalation Condition:** If Redis cannot be recovered and API latency exceeds team-policy thresholds, notify `#platform-infra`.

### 4.3: Celery Worker Diagnostics & Safe Restart
- **Symptom:** Step 2.5 fails; refunds are queued but not processed; worker pod silent.
- **Diagnostic Command:** Inspect worker logs for deadlocks, memory pressure, or external service timeouts:
  ```bash
  kubectl logs -n production [confirmed-worker-pod-name] --tail=100
  ```
- **Expected Result:** Identify whether the worker process crashed or hung on task execution.
- **Recovery Steps:**
  1. Restart the worker deployment to re-initialize task consumers:
     ```bash
     kubectl rollout restart deployment/[confirmed-worker-deployment-name] -n production
     kubectl rollout status deployment/[confirmed-worker-deployment-name] -n production
     ```
- **Post-Recovery Verification:** Re-run Step 2.5 (`celery -A orderflow.worker inspect ping`). Confirm worker responds with `OK`. Verify that queued refund tasks begin completing.
- **Escalation Condition:** If worker pods fail to start or remain unresponsive after restart, escalate to `#orderflow-oncall`.

---

## 5. Deployment Rollback Procedure

Execute rollback if an incident is triggered by a recent release and cannot be resolved by application restarts.

### Step 5.1: Execute Confirmed Helm Rollback Command
```bash
# Exact confirmed rollback command from service specification
helm rollback orderflow --namespace production
```
- **Expected Outcome:** Helm outputs confirmation that revision rollback was initiated.

### Step 5.2: Track Rollback Deployment Status
```bash
# Verify rollback completion on active deployments
kubectl get pods -n production -w
```
- **Expected Outcome:** Previous version pods reach `Running` state and replace failing pods.

### Step 5.3: Post-Rollback Health Verification
1. Run Step 2.2 (API response verification).
2. Check recent application logs:
   ```bash
   kubectl logs -n production [newly-created-pod-name] --tail=50
   ```
- **Stopping Condition:** If rollback command fails or pods continue failing after rollback completion, **STOP** and immediately escalate to `#platform-infra`.

---

## 6. Escalation Matrix

Escalate using the exact confirmed channels below:

| Condition / Symptom | Primary Channel | Escalation Target | Threshold / When to Escalate |
| :--- | :--- | :--- | :--- |
| **Service Outage / Checkout Disruption** | PagerDuty | `OrderFlow Primary` | API returning 5xx or order creation halted beyond team-policy threshold |
| **Active Incident Coordination** | Slack | `#orderflow-oncall` | Any active production disruption requiring engineering coordination |
| **Database Failure / Schema Discrepancy** | Slack | `#data-eng` | PostgreSQL unreachable, connection saturation, or migration requirements |
| **Kubernetes / Helm / Infrastructure Failure** | Slack | `#platform-infra` | Helm rollback failure, cluster node errors, or container scheduling failures |

---

## 7. Incident Closure & Post-Recovery Verification

Before resolving an alert, confirm all recovery verification criteria:

1. **Service Verification:** API responds to requests and database connectivity is verified via Step 2.3.
2. **Stability Period:** Monitor service health and error rates for the duration required by team operational policy before resolving the incident.
3. **Escalation Notification:** Post an incident summary update to `#orderflow-oncall` detailing:
   - Root cause / trigger identified
   - Corrective actions executed (including exact commands run)
   - Follow-up items identified for postmortem review
4. **PagerDuty Resolution:** Mark the PagerDuty incident as `Resolved`.
