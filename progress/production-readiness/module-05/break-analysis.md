# Module 05: Failure Mode Analysis - Break Analysis

## Executive Summary
A diagnostic failure analysis was conducted on the injected break scenarios, investigating three insidious failure modes where basic monitoring falsely indicates health while user requests fail.

---

## Detailed Scenario Diagnoses

### Scenario A: DNS Resolution Failure (The Phantom Database Outage)
- **Observed Symptom:**
  API returns connection errors (`ENOTFOUND`, `getaddrinfo EAI_AGAIN`). The database container itself is running, healthy, and accessible via local `psql 127.0.0.1:5432`.
- **Root Cause:**
  Container DNS resolution failure. The application connects to a hostname (`postgres` or `db.internal`). If the container runtime's internal DNS daemon (Docker embedded DNS `127.0.0.11` or Kubernetes CoreDNS) experiences a timeout, packet drop, or misconfigured `/etc/resolv.conf`, the application cannot translate the hostname to an IP address.
- **Diagnostic Proof:**
  Executing `docker exec <app> nslookup postgres` or `getent hosts postgres` fails with `Name or service not known`, proving the network transport is fine but the name resolution layer has collapsed.
- **Remediation:**
  Configure resilient DNS search domains, keepalive connection caching, and explicit fallback nameservers in Docker daemon / Pod specs.

---

### Scenario B: The Slow Dependency & Connection Pool Starvation
- **Observed Symptom:**
  API response times jump from 200ms to 5,000ms. `GET /live` returns 200 OK, yet business endpoints hang or fail.
- **Root Cause:**
  A downstream database or cache is not down, but responding with massive latency (e.g., unindexed queries, table locks, or high CPU utilization). Because `GET /live` is an in-memory vitality probe, it passes. Meanwhile, user requests pile up waiting for slow database responses, holding connection pool slots open until the pool is exhausted. Once the pool is empty, every subsequent request is blocked.
- **Remediation:**
  - Bound every database query with a strict query timeout (e.g. 2,000ms).
  - Implement a circuit breaker (Module 06) that trips to Open state when p95 latency exceeds threshold, failing fast with HTTP 504.
  - Hard limit maximum connection pool queue capacity to prevent memory bloat.

---

### Scenario C: Partial Failure (Read-Only Primary / Replica Failover)
- **Observed Symptom:**
  Reads (`GET /:code`) succeed seamlessly, but writes (`POST /api/links`) fail with database errors (`cannot execute INSERT in a read-only transaction`).
- **Root Cause:**
  The database has entered read-only mode due to disk volume saturation (>95% disk usage), or the primary database crashed and the connection string is erroneously connected to an un-promoted read replica.
- **Remediation:**
  - Enhance `/ready` health probe to execute a lightweight write probe or verify `pg_is_in_recovery() == false`.
  - Fail fast with specific HTTP 503 (`READ_ONLY_MODE`) responses rather than generic 500 errors.
