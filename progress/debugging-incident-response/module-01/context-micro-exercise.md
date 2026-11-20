# Debugging & Incident Response — Module 01 Step 1: CONTEXT

**Session ID**: `nio880GmEu6L7HqkpqO90`  
**Skill**: Debugging & Incident Response (`debugging-incident-response`)  
**Pack**: Launchpad (`spk_debugging_incident_response_launchpad`)  
**Module**: Module 01 — Hypothesis-First Debugging  
**Step**: Step 1: CONTEXT (`context`)  
**Timestamp**: 2026-11-19T10:43:00Z  

---

## 1. Context Analysis: The Inherited Mystery Service

### 1.1 The Operational Incident
- A key developer left abruptly with zero handoff documentation.
- The core internal URL shortener service (`linkops`), running in production for a year, is down and crashing on startup.
- Users report broken redirects, on-call alert fired at 8:47 AM, and there is no existing runbook.

### 1.2 The Method: Hypothesis-First Debugging
- Developers spend 35–50% of their careers debugging.
- **Shotgun Debugging (Junior Antipattern)**: Frantically changing code, swapping configs, restarting services, and littering print statements hoping to stumble into a fix. It wastes time, pollutes the codebase, and introduces secondary bugs.
- **Hypothesis-First Debugging (Senior Discipline)**:
  1. Observe the observable symptoms without modifying code.
  2. Formulate explicit, testable, falsifiable hypotheses (differential diagnosis).
  3. Design minimal, targeted tests to confirm or eliminate each hypothesis in order of likelihood.
  4. Converge directly on the root cause without reading unrelated code or thrashing.

---

## 2. Micro-Exercise: Resolving a 500 Internal Server Error

**Observed Symptom**: A web service returns an HTTP 500 Internal Server Error. Zero code has been modified; zero full logs have been read.

### Hypothesis 1: Database Connection Failure (Downstream Dependency Outage)
- **Decision / Hypothesis**: The web service crashed or threw an unhandled error because it cannot reach its primary database instance (e.g., PostgreSQL service is stopped, crashed, or connection credentials/port are misconfigured).
- **Single Action/Command to Test**:
  ```bash
  docker ps --filter "name=db" --filter "status=running"
  # or probe database port connectivity directly:
  pg_isready -h 127.0.0.1 -p 5432
  ```
- **Evidence Expected**: If `pg_isready` returns `rejecting connections` or `no response`, or if the database container is stopped/exited, Hypothesis 1 is **confirmed**. If the database responds `accepting connections`, Hypothesis 1 is **ruled out in < 5 seconds**.
- **Tradeoff**: Quickly verifies infrastructure connectivity without reading application code, but does not test whether application queries or schemas are valid.
- **Next Verification**: If the DB is healthy, move immediately to Hypothesis 2.

### Hypothesis 2: Unhandled Runtime Exception / Crash in Application Code
- **Decision / Hypothesis**: The application server is running and reachable, but an incoming request triggered an unhandled exception in controller/service logic (e.g., `TypeError: Cannot read properties of undefined`, missing environment variable, or null pointer).
- **Single Action/Command to Test**:
  ```bash
  docker logs linkops-api --tail 50 | grep -iE "error|exception|typeerror"
  ```
- **Evidence Expected**: If the output shows a concrete stack trace (e.g. `TypeError at links.controller.js:42`), Hypothesis 2 is **confirmed** and pinpoints the exact failure line. If logs show no error frames for the request, Hypothesis 2 is ruled out (pointing to upstream proxy/gateway timeouts).
- **Tradeoff**: Pinpoints the exact line and error type within seconds, but requires the application logging framework to be functional.
- **Next Verification**: Inspect the exact line in the stack trace to identify the missing guard or unhandled parameter.

---

## 3. Reflection: The 30-Second Engineering Habit

By taking thirty seconds to formulate two falsifiable hypotheses and identifying their single confirming commands, we avoided:
1. Blindly reading hundreds of lines of inherited unfamiliar source code.
2. Arbitrarily restarting servers and masking transient states.
3. Guessing configuration values.

This hypothesis-first habit converges on truth through directed inquiry.
