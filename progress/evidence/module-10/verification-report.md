# Module 10: CI/CD & Deployment — Official VERIFY Report

## 1. Executive Summary & Verification Context

In **Module 10 (CI/CD & Deployment)**, the verification step evaluates seven core operational and architecture questions governing containerized deployment, liveness/readiness separation, lifecycle management, timeouts, and configuration boundaries.

This report reviews the answers against the actual codebase implementation (`api/src/main.ts`, `validate-env.ts`, `health.controller.ts`, `api/Dockerfile`, `package.json`, and `.github/workflows/ci.yml`), removing unsupported platform-specific assumptions and ensuring all claims strictly reflect verified code.

---

## 2. Technical Evaluation of the Seven Official VERIFY Questions

### Question 1: What breaks if `PORT` is hardcoded?

#### Verified Technical Explanation:
- In containerized deployment platforms, the platform dynamically assigns an ingress port and supplies it to the container via the `PORT` environment variable. Platform ingress routers and health probes route external traffic to `$PORT`.
- If an application ignores `PORT` and hardcodes a fixed port (e.g., 3000):
  1. The server listens on the hardcoded port while the platform proxy attempts to connect to `$PORT`.
  2. The platform receives connection failures (e.g., `ECONNREFUSED`), health checks fail to reach the application, and traffic routing cannot succeed.
- Furthermore, the server must explicitly bind to `0.0.0.0` (all IPv4 network interfaces) rather than `localhost` (`127.0.0.1`), ensuring the kernel accepts traffic routed across the container's virtual network interface rather than restricting packets to the loopback interface.
- **Codebase Implementation**:
  - `api/src/config/validate-env.ts`: `validateEnv()` parses `process.env.PORT`, enforces digits `/^\d+$/`, and validates range `1 <= port <= 65535`.
  - `api/src/main.ts`: `await app.listen(env.port, '0.0.0.0');`.

---

### Question 2: What should the health endpoint check (and not check)?

#### Verified Technical Explanation:
- The liveness endpoint (`GET /health`) should check whether the application process is running and able to respond to HTTP requests.
- **Implementation Reality**:
  - `api/src/health/health.controller.ts`:
    ```typescript
    @Get('health')
    @HttpCode(HttpStatus.OK)
    health() {
      return { ok: true };
    }
    ```
  - The endpoint returns an immediate, static in-memory JSON response (`HTTP 200 { ok: true }`). It does not explicitly measure event-loop lag or inspect internal heap metrics.
- **What it must NOT check**:
  - It must **not** check external dependencies such as PostgreSQL or Redis.
  - Excluding external dependencies ensures that transient database or cache hiccups do not cause liveness checks to fail, avoiding unnecessary container restarts when the application process itself is healthy.

---

### Question 3: What should readiness check, and why?

#### Verified Technical Explanation:
- The readiness endpoint (`GET /ready`) should verify whether the backing dependencies necessary to process user traffic are established and operational.
- **Codebase Implementation**:
  - `api/src/health/health.controller.ts`:
    1. PostgreSQL: executes `PrismaService.ping()`, which runs `SELECT 1` via `this.$queryRaw`.
    2. Redis: executes `RedisCacheService.ping()`, which issues `PING` expecting `PONG` (bounded by a 500ms command timeout).
  - If both dependencies are reachable: returns **HTTP 200** `{"ok":true,"status":"ready","db":"ok","redis":"ok"}`.
  - If either dependency fails or is unreachable: returns **HTTP 503 Service Unavailable** `{"ok":false,"status":"unready",...}`.
- **Operational Purpose**:
  - Signals to upstream load balancers or orchestrators whether the container is ready to accept user ingress traffic.
  - Prevents traffic from being routed before connection pools complete initial handshakes during startup, and indicates when an instance should be temporarily bypassed during backing dependency outages without terminating the container.

---

### Question 4: What does a graceful shutdown protect?

#### Verified Technical Explanation:
- Graceful shutdown allows in-flight requests to complete and releases backing resources cleanly when the container receives a termination signal (`SIGTERM` or `SIGINT`), rather than abruptly dropping connections.
- **Verified Implementation Behavior**:
  1. **HTTP API**: `app.enableShutdownHooks()` in `main.ts` intercepts `SIGTERM`/`SIGINT`, stops accepting new traffic, drains active HTTP connections, and triggers `onModuleDestroy()` on providers (`PrismaService` calls `$disconnect()`, `RedisCacheService` calls `client.quit()`). In automated tests, the API drained and exited in **44ms**.
  2. **Worker Process**: `worker.ts` intercepts `SIGTERM`/`SIGINT`, invokes `app.close()`, and emits `worker_stopping` followed by `worker_stopped` on `AnalyticsWorkerService`.
- **Nuance & Scope Distinction**:
  - Verified: The API and worker processes cleanly intercept signals, disconnect from Prisma and Redis, and stop accepting new work.
  - Unverified: Specific guarantees that long-running or active BullMQ jobs will complete under all termination scenarios depend on job duration relative to external process termination grace periods and have not been independently tested under high concurrency.

---

### Question 5: What timeouts would you set and why?

#### Verified Technical Explanation:
- Timeouts must be bounded to prevent requests, cache operations, and worker queues from hanging indefinitely during dependency slowdowns or network partitions.
- **Actual Implementation Values Verified in Source**:
  1. **Redis command & connect timeout (500ms)**:
     - `REDIS_COMMAND_TIMEOUT_MS = 500` and `REDIS_CONNECT_TIMEOUT_MS = 500` in `api/src/cache/redis-cache.service.ts` (wrapped with a 600ms promise race limit).
     - Rationale: Ensures cache lookups fail fast so the application can immediately fall back to PostgreSQL without stalling HTTP redirects.
  2. **BullMQ enqueue timeout (250ms)**:
     - `QUEUE_ENQUEUE_TIMEOUT_MS = 250` in `api/src/analytics/analytics.constants.ts`.
     - Rationale: Ensures asynchronous analytics event submission fails open quickly if Redis is under backpressure, preserving redirect responsiveness.
  3. **Server shutdown race timeout (10,000ms)**:
     - Verified shutdown wait threshold ensuring the process completes connection cleanup and exits within a bounded window before being forcefully terminated.

---

### Question 6: What is the rollback plan if a migration fails in production?

#### Verified Technical Explanation:
- **Implemented Mechanism**:
  - Database migrations are decoupled from application startup into a dedicated one-off command: `"migrate": "prisma migrate deploy"` in `api/package.json`.
  - In CI/CD pipelines, this command executes as an isolated step before new application containers are deployed.
- **Failure Recovery Procedure**:
  - The deployment process should stop if the one-off migration command fails, preventing new application containers from being deployed until the migration issue is resolved. This gating must be configured by the deployment pipeline; it is not automatically implemented in this repository.
  - The failure must be inspected (e.g., checking the `_prisma_migrations` table for the recorded error).
  - Recovery requires manual intervention based on inspecting the actual database state. `prisma migrate resolve` only updates Prisma's migration tracking state in `_prisma_migrations` and does not automatically reverse partially executed SQL; remediation requires manually correcting database schema drift or deploying a forward-fixing migration.
- **Conceptual Production Practice (Expand/Contract)**:
  - Designing migrations to be backward-compatible (additive: new nullable columns, tables, or indexes) ensures that if newly deployed application code fails, rolling back to the previous application image is safe, because previous application code continues to operate against the expanded database schema without requiring a destructive database rollback.
  - *(Note: Automated deployment rollback orchestration and snapshot rollbacks are conceptual operational procedures and are not automated in this repository).*

---

### Question 7: What’s the difference between build-time and runtime config?

#### Verified Technical Explanation:
- **Build-Time Configuration**:
  - Used during container image creation and compilation in `api/Dockerfile`.
  - Includes: the base OS image (`node:20-alpine`), dependency installation, TypeScript compilation (`tsc`), and Prisma Client code generation (`npx prisma generate`).
  - Characteristics: Static and immutable once the image is built. Local environment files (`.env`, `.env.*`) are excluded from image layers via `.dockerignore` to prevent baking credentials into image history.
- **Runtime Configuration**:
  - Injected dynamically when the container process starts via environment variables (`PORT`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`).
  - Validated on startup by `api/src/config/validate-env.ts`, failing fast before the HTTP server binds its port if required variables are missing or malformed.
  - Characteristics: Dynamic; allows the exact same immutable container image (`bootcamp-api:latest`) to run across test, staging, and production environments by varying injected environment variables.

---

## 3. Concrete Verification Evidence Summary

- Automated Test Suite: [health-readiness-tests.txt](file:///D:/Knack%20labs/progress/evidence/module-10/health-readiness-tests.txt) (22/22 checks passed).
- Read-Only BUILD Audit: [final-build-audit.md](file:///D:/Knack%20labs/progress/evidence/module-10/final-build-audit.md).
- Migration Deploy Evidence: [migration-deploy.txt](file:///D:/Knack%20labs/progress/evidence/module-10/migration-deploy.txt).
- Docker Build Evidence: [docker-build.txt](file:///D:/Knack%20labs/progress/evidence/module-10/docker-build.txt).
- Graceful Shutdown Evidence: [graceful-shutdown.txt](file:///D:/Knack%20labs/progress/evidence/module-10/graceful-shutdown.txt).
- Clean Q&A Document: [verification-answers.md](file:///D:/Knack%20labs/progress/evidence/module-10/verification-answers.md).
