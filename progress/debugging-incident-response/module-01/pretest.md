# Debugging & Incident Response — Module 01: Pretest & Setup Check

**Session ID**: `nio880GmEu6L7HqkpqO90`  
**Skill**: Debugging & Incident Response (`debugging-incident-response`)  
**Pack**: Launchpad (`spk_debugging_incident_response_launchpad`)  
**Module**: Module 01  
**Step**: PRETEST (`pretest`)  
**Timestamp**: 2026-11-19T09:09:30Z  

---

## Part A: Quick Setup Check

All required coding, runtime, and debugging utilities were inspected and confirmed operational on the host system:

| Tool | Required Version | Installed Version | Status |
|---|---|---|---|
| **Node.js** | v18+ | `v22.13.1` | **PASS** |
| **Docker** | Container runtime | `Docker version 28.3.2, build 578ccf6` | **PASS** |
| **Curl** | CLI HTTP client | `curl 8.22.0 (Windows)` | **PASS** |
| **Git** | VCS | `git version 2.53.0.windows.3` | **PASS** |

- **OS and Shell**: Windows 11 running PowerShell shell.
- **Missing tools or errors**: None; all 4 required development and debugging tools are installed, verified, and operational.

---

## Part B: Starting Questions & Diagnostic Answers

### 1. Self-Rating
- **Selected**: `strong`
- **Rationale**: I form systematic hypotheses before modifying code, isolate failure domains using call traces and binary search / bisection, and debug distributed issues across network, application, cache, and database boundaries.

### 2. A user reports "the app is slow." What are the first 3 things you check?
1. **Endpoint Latency Breakdown**: Inspect APM traces / access logs for p95/p99 response times to determine whether the delay is in the network, frontend rendering, backend processing, or database queries.
2. **System Resource Saturation**: Check host CPU usage, memory pressure / GC pauses, disk I/O wait, and open socket / file descriptor limits.
3. **Database Performance & Connection Pool Health**: Inspect slow query logs, database lock contention, missing indexes, and database connection pool saturation.

### 3. A log says: `ECONNREFUSED 127.0.0.1:5432`. In one sentence: what is probably wrong?
- The PostgreSQL database service is either stopped, crashed, or not actively listening for incoming TCP connections on port 5432 on localhost.

### 4. In one sentence: what's the difference between a symptom and a root cause?
- A symptom is the observable failure condition noticed by users or alerts (e.g., HTTP 504 gateway timeout), whereas the root cause is the underlying defect in code, configuration, or infrastructure that produced the failure (e.g., an unindexed query holding table locks).

### 5. Your fix works locally but the bug still happens in production. Name two possible reasons.
1. **Environmental Divergence**: Production configuration differences, missing environment variables, stale cache tiers, or production dataset sizes that trigger query plan degradation not visible on tiny local fixtures.
2. **Concurrency & Load Dynamics**: Race conditions, connection pool exhaustion, or deadlocks that only manifest under concurrent multi-client traffic.

### 6. Pick one and explain why: "Read the error message carefully first" vs "Try to reproduce it first"
- **"Read the error message carefully first"**: Reading the exact stack trace, error code, and context pinpoints the failing line and subsystem contract violation, preventing wasted time blindly trying to reproduce symptoms without an informed hypothesis.

### 7. It's 2 AM and your service is down. Users are affected. What do you do FIRST?
- **Selected**: **Check if anything was deployed recently** (to immediately initiate rollback or traffic mitigation; in production incidents, fast mitigation to restore user availability always precedes detailed code debugging).

### 8. A coworker says "it worked yesterday." In one sentence: what's the most useful follow-up question?
- "What code commits, configuration flags, schema migrations, or infrastructure updates were deployed between yesterday and when the failure began?"
