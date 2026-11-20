# Module 04: Observability - Context & Micro-Exercise

## 1. Debugging Without Observability
- **Initial Inspection:** Without telemetry (logs, metrics, traces), debugging a slow service requires manually inspecting infrastructure layers:
  - Host and container resource utilization: checking CPU spikes, memory leaks, disk I/O, and open file descriptors via OS tools (`top`, `vmstat`, `docker stats`).
  - Database diagnostics: inspecting connection pool saturation, locked rows, and slow query logs directly on the database engine.
  - Raw stdout streams: grepping through unstructured console output without standardized formatting.
- **Why It Is Painful and High-Risk:**
  - Zero correlation: impossible to link an individual slow user transaction to a specific database query or downstream timeout.
  - High Mean Time to Recovery (MTTR): engineers spend hours formulating hypotheses and guessing bottlenecks rather than pinpointing root causes immediately via metrics and traces.

---

## 2. Liveness (`/live`) vs. Readiness (`/ready`)
- **Liveness Probe (`/live`):**
  - **Purpose:** Answers *"Is the application process alive and responsive?"*
  - **Behavior:** Verifies that the internal event loop or runtime thread is not locked or deadlocked. Returns HTTP 200 immediately without pinging external databases or networks.
  - **Orchestrator Action:** If it fails, the orchestrator kills and restarts the container.
- **Readiness Probe (`/ready`):**
  - **Purpose:** Answers *"Is the service ready to handle ingress user traffic?"*
  - **Behavior:** Checks critical operational dependencies (PostgreSQL connection pool, Redis cache/queue, migration state).
  - **Orchestrator Action:** If it fails (e.g., HTTP 503 during transient database maintenance), the ingress load balancer temporarily routes traffic away from this instance *without* terminating the process. This avoids catastrophic restart loops.
