# Production Readiness: Starting Check (Pretest)

## Part A: Quick Setup Check
- **OS & Shell:** Windows 11, PowerShell
- **Docker Version:** Docker version 28.3.2, build 578ccf6
- **Node.js & pnpm:** Node v22.13.1, pnpm 12.16.1
- **Python:** Python 3.13.9
- **Git Version:** git version 2.53.0.windows.3
- **Curl Version:** curl 8.22.0 (Windows)
- **Tool Status:** All required containerization, runtime, source control, and network probe tools are present and operational.

---

## Part B: Starting Questions & Learner Responses

### 1. Self-Rating
**Answer:** `ok` (I've deployed things but don't fully understand what happens after)

### 2. Dockerfile vs Docker Image
**Answer:** A Dockerfile is a set of instructions used to build an application environment, whereas a Docker image is the packaged, immutable artifact created from those instructions.

### 3. Two Things That Could Go Wrong in Production
**Answer:**
- Environment variables or configuration may be missing or incorrect.
- Database failures, network issues, or unexpected traffic may affect the application.

### 4. Liveness vs Readiness
**Answer:** Liveness checks whether the application is running properly, while readiness checks whether it is ready to receive traffic. This distinction prevents unhealthy or unprepared instances from receiving requests.

### 5. Response Times Doubled After Deployment
**Answer:** C) Check metrics such as latency, error rates, and resource usage first, then decide whether to roll back.

### 6. Development Philosophy
**Answer:** "Ship fast, fix in production" can be risky without proper testing and monitoring. I prefer shipping frequently with automated tests, monitoring, and rollback mechanisms to balance speed and reliability.

### 7. Why Having No Monitoring is Risky
**Answer:** Problems can remain undetected for a long time because there is no visibility into failures, performance degradation, or unusual application behavior.

### 8. Graceful Degradation
**Answer:** Graceful degradation means that when part of a system fails, the application continues providing its essential functionality instead of failing completely.
