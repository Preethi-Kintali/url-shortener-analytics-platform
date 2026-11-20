# Module 08: Deploy & Verify - Context

## 1. Liveness vs. Readiness Under Production Scrutiny

### Architectural Boundary
- **Liveness (`GET /live`):**
  - **Objective:** Proves the Node.js runtime process is alive, unblocked, and actively servicing the event loop.
  - **Failure Boundary:** If `/live` fails (e.g. unhandled deadlock or crash), container orchestrators (Docker/K8s) issue a `SIGKILL`/`SIGTERM` to reboot the container.
  - **Critical Rule:** Never couple `/live` to backing network dependencies (PostgreSQL/Redis). If a database partition occurs, rebooting a healthy application process accomplishes nothing and destroys forensic memory/logs.
- **Readiness (`GET /ready`):**
  - **Objective:** Proves the application can actively query its mandatory backing dependencies and safely accept production ingress traffic.
  - **Failure Boundary:** If `/ready` fails (returns HTTP 503), the load balancer or reverse proxy removes the instance from ingress rotation. The process remains alive, waiting for dependencies to heal.
- **Blind Spots of Relying Solely on Liveness:**
  - Database connection pool exhaustion (`P1001`/`P1002`).
  - Redis cache disconnects or command timeouts.
  - Uncaught startup initialization failures.
  - Schema mismatches where queries fail on invalid column names.

---

## 2. Immediate 2-Minute Incident Response Protocol (Post-Deploy Error Spike)

| Time Window | Operational Actions | Tools & Commands |
|---|---|---|
| **00:00 – 00:30** | Acknowledge P1 alert; correlate error spike timestamp with recent Git commit SHA deployment. | PagerDuty / `#ops-url-shortener` |
| **00:30 – 01:00** | Inspect `/ready` endpoint, check error rates by route (`/metrics`), extract structured error logs and `request_id`. | `curl -s http://localhost:3000/ready`<br>`docker logs --since 5m myservice-prod` |
| **01:00 – 01:30** | Triage root cause: If error surge is correlated with the new commit SHA, abort debugging under fire and execute immediate rollback. | `myservice:$PREV_SHA` rollback protocol |
| **01:30 – 02:00** | Verify previous immutable version is serving traffic; verify `/ready` returns HTTP 200; confirm error rates drop below 0.1% baseline. | `curl -s http://localhost:3000/ready`<br>`GET /metrics` |
