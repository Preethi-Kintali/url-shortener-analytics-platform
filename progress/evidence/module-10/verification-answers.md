# Module 10: CI/CD & Deployment — Verified Answers

### 1. What breaks if PORT is hardcoded?
If the port is hardcoded (e.g., to 3000), the application cannot bind to the port assigned by the hosting platform via the `PORT` environment variable. Platform ingress routers and health checks route traffic to `$PORT`; when the application ignores `$PORT`, the platform receives connection errors (e.g., `ECONNREFUSED`), health checks fail, and the deployment cannot receive traffic. The application must parse and validate `process.env.PORT` at runtime and explicitly bind to `0.0.0.0` rather than `localhost` (`127.0.0.1`), ensuring the container accepts external traffic routed through its virtual network interface.

### 2. What should the health endpoint check (and not check)?
The health endpoint (`GET /health`) should check whether the application process is up and capable of handling HTTP requests. In our implementation, it returns an immediate in-memory response (`HTTP 200 { ok: true }`). It should **not** check external dependencies like PostgreSQL or Redis. Excluding external dependencies ensures that transient database or cache connectivity issues do not cause process liveness checks to fail and trigger unnecessary container restarts.

### 3. What should readiness check, and why?
The readiness endpoint (`GET /ready`) should verify that essential dependencies required to serve traffic are available. In our implementation, it executes `PrismaService.ping()` (running `SELECT 1`) to check PostgreSQL connectivity and `RedisCacheService.ping()` (sending `PING` and expecting `PONG`) to check Redis. If both succeed, it returns `HTTP 200 {"ok":true,"status":"ready","db":"ok","redis":"ok"}`. If either dependency is unreachable or fails, it returns `HTTP 503 {"ok":false,"status":"unready",...}`. This signals to load balancers or platform orchestrators not to route traffic to the container until its backing dependencies are ready.

### 4. What does a graceful shutdown protect?
Graceful shutdown stops accepting new incoming traffic while allowing in-flight requests and background resources to terminate cleanly before the process exits. In our implementation, `app.enableShutdownHooks()` intercepts `SIGTERM`/`SIGINT`, drains the HTTP server, and triggers `onModuleDestroy()` to disconnect Prisma (`$disconnect()`) and close Redis (`client.quit()`). For the worker process, `worker.ts` intercepts termination signals and stops the BullMQ worker service (`worker_stopped`). Note: while the worker stops accepting new jobs and disconnects cleanly, guarantees about active BullMQ jobs finishing depend on job execution duration relative to process termination limits and have not been independently stress-tested.

### 5. What timeouts would you set and why?
Timeouts must be bounded to prevent requests and resources from hanging indefinitely. Based strictly on the implementation:
1. **Redis operations (500ms)**: Configured as `REDIS_COMMAND_TIMEOUT_MS = 500` and `REDIS_CONNECT_TIMEOUT_MS = 500` (wrapped in a 600ms promise race limit) so cache misses or connectivity failures fail fast without stalling HTTP operations.
2. **BullMQ enqueue (250ms)**: Configured as `QUEUE_ENQUEUE_TIMEOUT_MS = 250` so asynchronous analytics job creation fails open quickly and does not compromise redirect latency.
3. **Server shutdown race timeout (10,000ms)**: Bounded shutdown wait period ensuring the process exits cleanly within a reasonable window before an ungraceful kill occurs.

### 6. What is the rollback plan if a migration fails in production?
In our codebase, migrations are decoupled from application startup into a dedicated one-off command (`npm run migrate`, which runs `prisma migrate deploy`). If a migration fails:
1. The deployment process should stop if the one-off migration command fails, preventing new application containers from being deployed until the migration issue is resolved. This gating must be configured by the deployment pipeline; it is not automatically implemented in this repository.
2. The failure must be inspected (e.g., checking the `_prisma_migrations` table for the failed migration record).
3. Recovery requires manual remediation based on inspecting the actual database state. Note that `prisma migrate resolve` only updates Prisma's migration tracking state in the `_prisma_migrations` table and does not automatically reverse partially executed SQL. Depending on what failed, remediation requires manually correcting database schema drift or deploying a forward-fixing migration.
4. Conceptually, designing migrations to follow backward-compatible (expand-and-contract) patterns ensures that if an application deploy fails and is rolled back, the previous application version continues to work without requiring a destructive database schema rollback. (Note: automated deployment gating and rollback orchestration are conceptual production practices and are not automated in this repository).

### 7. What’s the difference between build-time and runtime config?
- **Build-time configuration**: Used during container image creation and compilation in `api/Dockerfile`. This includes the Node.js base image (`node:20-alpine`), package dependency installation, TypeScript compilation (`tsc`), and Prisma Client generation (`npx prisma generate`). Build-time artifacts are immutable, and `.dockerignore` ensures local environment files (`.env`) are excluded from image layers.
- **Runtime configuration**: Injected when the container process boots via environment variables (`PORT`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`). It is validated at process startup by `api/src/config/validate-env.ts`, failing fast if required values are missing or invalid. This separation allows the same container image to run across multiple environments by changing runtime variables.
