# Module 06 — Step 5: BREAK
## Incident Runbook Audit: OrderFlow Service (October 2025)

### Executive Summary

The provided OrderFlow incident runbook (`October 2025`, Platform Payments Team) presents a clean, structured appearance with professional markdown headings and diagnostic code blocks. However, a technical audit against OrderFlow's production architecture reveals **three catastrophic operational defects** that would cripple an on-call engineer at 3 AM, actively worsen an outage, and mislead incident responders into chasing phantom failures.

---

### Failure 1: Stale Environment Variable Reference (`DB_CONNECTION_STRING` vs. `DATABASE_URL`)

#### 1. Exact Location
- **Step 3 (Database Connection Failure)**:
  - Diagnostic command block (Lines 38–39):
    ```bash
    kubectl exec -n production deployment/orderflow-api -- \
      python -c "import psycopg2; psycopg2.connect('$DB_CONNECTION_STRING')"
    ```
  - Sub-step 3 verification (Lines 46–48):
    ```bash
    kubectl exec -n production deployment/orderflow-api -- printenv DB_CONNECTION_STRING
    ```

#### 2. What Happens to an On-Call Engineer at 3 AM
- OrderFlow's canonical environment variable for PostgreSQL connectivity is `DATABASE_URL` (as established in the service architecture specification), not `DB_CONNECTION_STRING`.
- When an engineer executes `printenv DB_CONNECTION_STRING`, the command prints an empty string.
- In the Python one-liner, `$DB_CONNECTION_STRING` expands to `""`. Calling `psycopg2.connect("")` attempts to connect using libpq defaults (local Unix domain socket on `/tmp/.s.PGSQL.5432` or `localhost:5432` with the local OS user), which fails immediately with an `OperationalError` (`could not connect to server: Connection refused`).
- **The Catastrophic Consequence**: The diagnostic command reports a database connection failure **even when PostgreSQL is completely healthy and reachable**. The engineer follows the runbook's instruction: *"If it is empty or wrong, the deployment configuration needs updating"*, wrongly concluding that database credentials were wiped out or that Kubernetes secret synchronization failed. The engineer spends 30+ minutes debugging healthy deployment manifests while the true root cause remains unaddressed.

#### 3. The Correct Fix
- Replace all occurrences of `DB_CONNECTION_STRING` with the canonical variable `DATABASE_URL`.
- Guard against shell expansion quirks by retrieving the variable safely inside Python via `os.environ.get()`:
  ```bash
  # Step 3.1: Verify environment variable presence
  kubectl exec -n production deployment/orderflow-api -c orderflow-api -- printenv DATABASE_URL

  # Step 3.2: Safely test PostgreSQL connectivity
  kubectl exec -n production deployment/orderflow-api -c orderflow-api -- \
    python3 -c "
  import os, sys, psycopg2
  url = os.environ.get('DATABASE_URL')
  if not url:
      print('ERROR: DATABASE_URL is not set in container environment', file=sys.stderr)
      sys.exit(1)
  try:
      conn = psycopg2.connect(url, connect_timeout=5)
      cur = conn.cursor()
      cur.execute('SELECT 1;')
      print('PostgreSQL connection SUCCESSFUL:', cur.fetchone())
      conn.close()
  except Exception as e:
      print(f'PostgreSQL connection FAILED: {e}', file=sys.stderr)
      sys.exit(2)
  "
  ```

---

### Failure 2: Dangerous Anti-Rollback Command (Deploying Broken Build Instead of Rolling Back)

#### 1. Exact Location
- **Step 6 (Application Bug - 500 Errors)**:
  - Sub-step 2 rollback instruction (Lines 77–78):
    ```bash
    # 2. If the errors started after the last deployment, roll back:
    helm upgrade orderflow deploy/charts/orderflow --namespace production --set image.tag=latest
    ```

#### 2. What Happens to an On-Call Engineer at 3 AM
- The section heading and instruction promise a **safe rollback** to the prior release.
- However, the command executes `helm upgrade` and sets `image.tag=latest`.
- In a modern CI/CD pipeline, the `latest` tag points either to:
  1. The exact same flawed build that just triggered the 500 error storm, or
  2. An unvetted, unreleased commit currently on the tip of the development branch.
- Furthermore, running `helm upgrade` deploys a *new* Helm revision rather than rolling back to a known-stable historical revision.
- **The Catastrophic Consequence**: Instead of recovering the service to the last known healthy release, the engineer rolls forward into the broken image or restarts all pods onto the same broken code. This restarts container lifecycles, drops in-flight payment sessions, terminates healthy worker pods, prolongs the 500-error outage, and generates false Helm release history.

#### 3. The Correct Fix
- Inspect Helm revision history to identify the last known-stable revision number:
  ```bash
  helm history orderflow --namespace production
  ```
- Use Helm's native rollback command to revert to the specific verified prior release (or previous release by default):
  ```bash
  # Option A: Roll back to previous revision (n-1)
  helm rollback orderflow --namespace production

  # Option B: Roll back to a specific known-stable revision (e.g., revision 42)
  helm rollback orderflow 42 --namespace production --wait --timeout 3m
  ```
- Verify deployment rollout status before declaring success:
  ```bash
  kubectl rollout status deployment/orderflow-api -n production --timeout=120s
  ```

---

### Failure 3: Complete Omission of Redis & Celery Worker Diagnostics

#### 1. Exact Location
- **Step 1, Step 2, and Entire Runbook Workflow**:
  - Step 1 expects `cache: "connected"` and `worker: "running"` in the health payload (Lines 21–22).
  - Step 2 claims (Line 31):
    ```text
    - ConnectionRefusedError -- database or cache is down (go to Step 3)
    ```
  - However, **Step 3 exclusively diagnoses PostgreSQL**. Redis is never mentioned, probed, or tested anywhere in the document.
  - Celery worker queues, task lag, and worker health are completely absent.

#### 2. What Happens to an On-Call Engineer at 3 AM
- OrderFlow relies on Redis for two mission-critical payment pathways:
  1. Rate limiting on payment API endpoints (protecting payment gateways and preventing abuse).
  2. Asynchronous task queue broker (`CELERY_BROKER_URL`) for processing customer refunds and transactional fulfillment.
- If Redis fails, or if Celery worker pods crash or hang on an unhandled exception:
  - API requests experience connection timeouts or fail open/closed on rate limiting.
  - Customer refunds silently queue up or fail completely.
  - An on-call engineer following this runbook sees `ConnectionRefusedError` in API logs, navigates to Step 3, tests PostgreSQL, finds PostgreSQL 100% operational, and has **zero instructions** for diagnosing Redis or Celery.
- **The Catastrophic Consequence**: The engineer exhausts the runbook, assumes the issue is outside their purview, and either gives up or escalates unnecessarily while customer refunds accumulate multi-hour backlogs and payment processing remains severely degraded.

#### 3. The Correct Fix
- Add a dedicated **Step 3B: Redis Cache & Celery Broker Failure**:
  ```bash
  # Check Redis environment variable
  kubectl exec -n production deployment/orderflow-api -c orderflow-api -- printenv REDIS_URL

  # Test Redis connectivity from API container
  kubectl exec -n production deployment/orderflow-api -c orderflow-api -- \
    python3 -c "
  import os, sys, redis
  url = os.environ.get('REDIS_URL')
  if not url:
      print('ERROR: REDIS_URL not set', file=sys.stderr)
      sys.exit(1)
  try:
      r = redis.Redis.from_url(url, socket_timeout=3)
      if r.ping():
          print('Redis PING SUCCESSFUL')
  except Exception as e:
      print(f'Redis PING FAILED: {e}', file=sys.stderr)
      sys.exit(2)
  "
  ```
- Add dedicated **Celery Worker Diagnostics**:
  ```bash
  # Check Celery worker pod health
  kubectl get pods -n production -l app=orderflow-worker

  # Inspect active Celery queues and consumers
  kubectl exec -n production deployment/orderflow-worker -c orderflow-worker -- \
    celery -A orderflow.tasks inspect active --timeout 5
  ```

---

### Summary Audit Table

| # | Failure Type | Runbook Location | Stated Action vs. Actual Action | Operational Impact at 3 AM | Remediated Procedure |
|---|---|---|---|---|---|
| **1** | **Stale Variable Reference** | Step 3 (Lines 38–39, 46–48) | Uses deprecated `DB_CONNECTION_STRING` instead of canonical `DATABASE_URL`. | `psycopg2.connect("")` fails on healthy DB; false alarm sends engineer debugging valid configs for hours. | Use `DATABASE_URL` via Python `os.environ.get()` with explicit 5s timeout and error reporting. |
| **2** | **Dangerous Rollback Command** | Step 6 (Lines 77–78) | Runs `helm upgrade ... --set image.tag=latest` instead of `helm rollback`. | Deploys unverified/broken `latest` build, resets pods, drops sessions, and extends 500-error outage. | Run `helm rollback orderflow [REVISION] --namespace production --wait` after checking `helm history`. |
| **3** | **Missing Dependency Diagnostics** | Step 2 & Step 3 (Lines 31–48) | Directs cache errors to Step 3, but Step 3 only tests Postgres. Completely omits Redis and Celery. | Redis failure or hung Celery worker leaves refunds stuck and rate limiting broken with zero troubleshooting guidance. | Add distinct Redis ping diagnostic (`REDIS_URL`) and Celery worker queue inspection steps (`CELERY_BROKER_URL`). |
