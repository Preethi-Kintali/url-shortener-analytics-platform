# Module 06 — VERIFY: Operational Runbook Audit

## 1. Python Diagnostic Snippets Validation

**Result: PASS**

- **Environment Variable Handling:** All snippets use `os.environ.get()` with explicit assertion checks (`assert db_url, 'DATABASE_URL not set'`), preventing unhandled crashes or ambiguous execution when environment configurations drift.
- **Connection Teardown & Resource Cleanup:** Database connection probes in Step 2.3 and Section 4.1 explicitly execute `cur.close()` and `conn.close()` upon query execution, preventing the diagnostic script itself from leaking connection pool slots during connection saturation incidents.
- **Error Handling:** Snippets isolate execution to single-command probes (`SELECT 1`, `Redis Ping: True`, `pg_stat_activity` state counts) that clearly distinguish connection refusal from query failure.

---

## 2. Placeholder & Discovery Command Audit

**Result: PASS**

- **Discovery Precedence:** Every command requiring a pod or deployment name is immediately preceded by a discovery command:
  - Pod operations (`[confirmed-orderflow-pod-name]`, `[confirmed-worker-pod-name]`) are preceded by Step 2.1: `kubectl get pods -n production -o wide`.
  - Deployment operations (`[confirmed-orderflow-deployment-name]`) are preceded by `kubectl get deployments -n production`.
- **Substitution Instructions:** Clear procedural instructions mandate confirming the active resource name from cluster telemetry rather than assuming hardcoded names.

---

## 3. Thresholds, Guarantees, and Factual Fidelity

**Result: PASS**

- **Zero Invented Thresholds:** Vague, ungrounded numerical metrics (such as *"10 items per minute queue draining"* or arbitrary 15-minute resolution windows) have been eliminated. All SLAs, queue draining expectations, and stability periods are strictly designated as team-policy values requiring verification.
- **No False Guarantees:** The runbook makes zero promises of *"instant recovery"* or *"zero customer downtime."* Operational risks are stated objectively with safe stopping conditions.

---

## 4. Confirmed Escalation Contacts Audit

**Result: PASS**

The escalation matrix in Section 6 and quick reference in Section 1 strictly limit contacts to the four verified scenario channels:
1. Slack `#orderflow-oncall`
2. PagerDuty `OrderFlow Primary`
3. Slack `#data-eng`
4. Slack `#platform-infra`

All unprovided organizational titles and secondary policies have been excised.

---

## 5. Dangerous Operations & Stopping Controls

**Result: PASS**

- **Database Session Termination Safety:** Section 4.1 contains an explicit approval gate: *"Do NOT terminate database sessions unilaterally. Terminating active transactions without DBA approval can abort valid customer checkouts or cause transaction state inconsistencies."* Engineers are directed to capture connection counts and consult `#data-eng`.
- **Schema Migration Guardrail:** Section 3.2 explicitly prohibits running `alembic upgrade head` as an emergency ad-hoc recovery action, explaining that schema changes require controlled deployment workflows coordinated with `#data-eng`.
- **Rollback Stopping Gate:** Section 5.4 mandates that if `helm rollback` fails or pods continue failing after rollback, the engineer must immediately stop and escalate to `#platform-infra`.

---

## 6. Procedural Completeness Matrix

Every recovery procedure in Section 4 satisfies all six operational criteria:

| Procedure | Symptom Defined | Diagnostic Command | Expected Result | Recovery Steps | Post-Recovery Verification | Escalation Condition |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **4.1 PostgreSQL Recovery** | Yes (API 500/503; Step 2.3 connection failure) | Yes (`pg_stat_activity` query) | Yes (summary of active/idle backends) | Yes (restart API deployment with approval) | Yes (re-run Step 2.3 `SELECT 1`) | Yes (escalate to `#data-eng` if unresolved) |
| **4.2 Redis Degraded Mode** | Yes (Step 2.4 timeout; latency rise; unthrottled) | Yes (check logs & degraded mode status) | Yes (confirm direct DB fallback) | Yes (discover controller & restart Redis) | Yes (re-run Step 2.4 `Redis Ping: True`) | Yes (notify `#platform-infra` if latency spikes) |
| **4.3 Celery Worker Reset** | Yes (Step 2.5 fails; refunds queued but stalled) | Yes (inspect worker logs for deadlock) | Yes (identify crash vs task hang) | Yes (restart worker deployment) | Yes (re-run Step 2.5 `inspect ping` & check queue) | Yes (escalate to `#orderflow-oncall` if unresponsive) |
