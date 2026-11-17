# Module 10: CI/CD & Deployment (Railway) — BUILD Implementation & Verification Report

## 1. Executive Summary & Implementation Status

In **Module 10 (CI/CD & Deployment on Railway)**, the complete production deployment pipeline and containerization infrastructure was implemented, hardened, and verified for the URL shortener and analytics system.

All 7 core requirements from the official Upsk BUILD instructions were met, and all 3 conceptual PAUSE checkpoints were addressed in depth:
1. **Multi-Stage Production Dockerfile**: Clean separation between `builder` and `runner` stages with non-root user `nestjs`, resulting in a lightweight 406MB OCI container image.
2. **Dynamic PORT & Host 0.0.0.0 Binding**: `api/src/main.ts` dynamically parses `process.env.PORT` and binds explicitly to `0.0.0.0` to permit platform ingress routing.
3. **Decoupled Liveness & Readiness Probes**:
   - `GET /health`: Liveness probe, always HTTP 200 `{ ok: true }` when process is running, rate-limit exempt (`@SkipThrottle()`).
   - `GET /ready`: Readiness probe, returns HTTP 200 only when PostgreSQL connection pool and Redis cache/queue broker are responsive; returns HTTP 503 quickly (< 1100ms) when degraded.
4. **Graceful Shutdown Lifecycle**: Activated `app.enableShutdownHooks()` in `main.ts` to intercept `SIGTERM`/`SIGINT`, draining in-flight HTTP requests and closing Prisma and Redis connection pools cleanly in ~44ms.
5. **Dedicated One-Off Migration Command**: Added `"migrate": "prisma migrate deploy"` to `package.json`, strictly decoupled from server and worker bootstrap.
6. **Production GitHub Actions CI**: Created `.github/workflows/ci.yml` running on push/PR with isolated `postgres:16-alpine` and `redis:7-alpine` service containers.
7. **Three Conceptual PAUSE Checkpoints**: Thoroughly analyzed health checks, liveness vs. readiness separation, and migration/rollback strategies.

### Verification Summary
- **Module 10 Verification Suite (`verify-module-10.ts`)**: **22 / 22 PASSED (100%)**
- **Live Docker Container Probes**:
  - `curl.exe http://localhost:3000/health` -> `HTTP 200 {"ok":true}`
  - `curl.exe http://localhost:3000/ready` -> `HTTP 200 {"ok":true,"status":"ready","db":"ok","redis":"ok"}`
  - `docker stop bootcamp-api` -> Graceful shutdown logged and exited code 0
- **Module 09 Full Regression Suite (`verify-module-09.ts`)**: **13 / 13 PASSED (100%)**
- **Safety Pre-flight Checks**: Zero mutation to development database `upsk_sdf` (links: 25 -> 25, clicks: 0 -> 0) and Redis DB 0 (188 -> 188 keys).

---

## 2. Mandatory Conceptual PAUSE Checkpoints

### PAUSE 1: Why Health Checks Matter and What They Detect
- **Orchestrator Contract**: Modern cloud orchestrators (Railway, Kubernetes, AWS ECS, Google Cloud Run) do not assume a container is operational simply because its OS kernel process is running. Orchestrators actively send periodic HTTP polling requests (every 5–15 seconds) to a configured path (e.g., `/health`).
- **What Liveness Health Checks Detect**:
  1. **Event Loop Starvation / Freezes**: In Node.js single-threaded event loop architectures, an infinite synchronous loop, CPU-bound calculation, or internal deadlock freezes request processing. A health check timeout exposes this immediately.
  2. **Zombie or Deadlocked Processes**: When child threads or sockets enter unrecoverable states without crashing the host process, health check timeouts signal the orchestrator to issue a `SIGKILL` and spawn a fresh replacement container.
  3. **Process CrashLoops & Cold Boot Timeouts**: If memory leaks cause the kernel to invoke OOMKiller, or if bootstrap fails under misconfigured environment variables, health checks ensure traffic is immediately diverted away from the dead instance.
- **Why Liveness Must Be Ultra-Lightweight**:
  - The liveness check (`GET /health`) must **never** make external database queries, Redis calls, or disk I/O. If a backing database experiences a transient 2-second CPU spike, a database-dependent liveness check will fail, causing the orchestrator to reboot the entire application fleet simultaneously—transforming a temporary database slow-down into a catastrophic self-inflicted cascade outage.

---

### PAUSE 2: Health vs. Readiness and Why Database Checks Belong in Readiness
- **The Core Distinction**:
  - **Health (Liveness)** answers: *"Is the process alive and capable of running code?"*
    - Failure consequence: Restart the container.
  - **Readiness** answers: *"Are all required backing dependencies ready to accept live user traffic right now?"*
    - Failure consequence: Temporarily remove the container from the ingress load balancer routing pool, but **do not restart it**.
- **Why Database & Redis Checks Belong Exclusively in Readiness (`GET /ready`)**:
  1. **Cold-Start Warmup Protection**: When a container first boots, NestJS binds the HTTP port within milliseconds, but Prisma's database connection pool and Redis connection sockets may take 100–500ms to perform initial TCP handshakes, TLS negotiation, and authentication. If user traffic is routed immediately upon port bind, initial users receive HTTP 500 errors. `/ready` prevents the ingress router from forwarding user requests until `SELECT 1` succeeds.
  2. **Graceful Degradation During Database Maintenance**: If PostgreSQL undergoes an automated minor-version patch, failover, or transient network blip:
     - With `/health` querying the database: The orchestrator kills and restarts the container repeatedly. Each restart floods the struggling database with hundreds of new connection initialization attempts (thundering herd).
     - With `/ready` querying the database: The container stays alive. `/ready` returns HTTP 503, signaling the ingress layer to pause traffic or fall back gracefully, while the application's connection pool retries cleanly with backoff until the database returns.

---

### PAUSE 3: Migration Strategy and Rollback Implications
- **Why We Selected One-Off Migrations (`one_off`) over Startup Migrations (`startup`)**:
  1. **Multi-Service Concurrency Hazards**: In our approved `multi_service` architecture, we run separate API web containers and BullMQ worker containers. If migrations are embedded into container startup scripts (`CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]`), scaling up 4 API replicas and 2 worker replicas triggers 6 concurrent migration commands competing against PostgreSQL migration lock tables, risking transaction timeouts and startup deadlocks.
  2. **Coupled Availability**: If a schema migration is slow (e.g. creating an index on millions of rows), running it at application startup delays container boot beyond the platform's 60-second health check timeout, causing the orchestrator to terminate the deployment before the migration can even finish.
  3. **Operational Clarity**: A dedicated one-off migration task (`npm run migrate`) runs once in an isolated release phase before the new application containers boot, ensuring schema changes succeed predictably prior to traffic ingress.

- **Safe Rollback Sequence with Expand/Contract Migrations**:
  - In continuous delivery, rolling back a deployment must never depend on rolling back a database migration (down-migrations are frequently lossy or destructive).
  - All migrations follow the **Expand and Contract pattern**:
    - **Phase 1 (Expand)**: Add new optional columns, nullable fields, or parallel tables. The existing production application ignores the new columns, while the database supports both schema versions.
    - **Phase 2 (Deploy Code)**: Deploy the new API and Worker versions that read/write the new schema.
    - **Rollback Safety**: If the new code contains an application bug, rolling back to the previous application version is instant and safe because the old code continues to function against the expanded schema without errors.
    - **Phase 3 (Contract)**: Only after the new version is verified and stable in production, a subsequent one-off migration removes old deprecated columns.

---

## 3. Implementation Details & Architecture Audit

### 1. Dockerfile Architecture (`api/Dockerfile`)
A production-hardened multi-stage Dockerfile was created:
```dockerfile
# Stage 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc* ./
RUN pnpm install --frozen-lockfile
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build
RUN pnpm prune --prod

# Stage 2: Minimal Production Runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json
USER nestjs
EXPOSE 3000
CMD ["node", "dist/main"]
```
- **Security**: Runs strictly under non-root unprivileged user `nestjs` (UID 1001).
- **Size Optimization**: Pruned devDependencies and excluded TypeScript compiler from runner, achieving a compact 406MB total image size.

### 2. Explicit 0.0.0.0 & Dynamic PORT Binding (`api/src/main.ts`)
```typescript
const env = validateEnv();
const app = await NestFactory.create(AppModule, { bufferLogs: true });

// Enable graceful shutdown hooks so Nest intercepts SIGTERM/SIGINT
app.enableShutdownHooks();

// Explicitly bind to 0.0.0.0 for containerized platforms (Railway, Docker)
await app.listen(env.port, '0.0.0.0');
logger.log({ event: 'server_started', port: env.port, host: '0.0.0.0' }, 'Bootstrap');
```

### 3. Decoupled Health & Readiness Probes (`api/src/health/health.controller.ts`)
```typescript
@Controller()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisCache: RedisCacheService,
  ) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  health() {
    return { ok: true };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: HttpResponseLike) {
    const isDbReady = await this.checkDb();
    const isRedisReady = await this.checkRedis();

    if (isDbReady && isRedisReady) {
      res.status(HttpStatus.OK);
      return { ok: true, status: 'ready', db: 'ok', redis: 'ok' };
    }

    res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      ok: false,
      status: 'unready',
      db: isDbReady ? 'ok' : 'unreachable',
      redis: isRedisReady ? 'ok' : 'unreachable',
    };
  }

  @Get('health/ready')
  healthReady(@Res({ passthrough: true }) res: HttpResponseLike) {
    return this.ready(res);
  }
}
```

### 4. GitHub Actions CI Configuration (`.github/workflows/ci.yml`)
- Provisions isolated ephemeral PostgreSQL 16 and Redis 7 service containers with health checks.
- Steps:
  1. `actions/checkout@v4`
  2. `pnpm/action-setup@v4` & `actions/setup-node@v4` with pnpm caching
  3. `pnpm install --frozen-lockfile`
  4. `npx prisma generate`
  5. `npx prisma migrate deploy`
  6. `pnpm run test`
  7. `pnpm run build`

---

## 4. Verification & Regression Evidence

The automated verification suite (`api/scripts/verify-module-10.ts`) was executed against the isolated test environment:
```text
====================================================================
UPSK MODULE 10 BUILD VERIFICATION: CI/CD & DEPLOYMENT (RAILWAY)
====================================================================

[PASS] Database & Redis isolation pre-flight verified — Database: upsk_sdf_test on localhost:5432, Redis DB: 1

--- Step 2: One-Off Migration Command Verification ---
[PASS] Dedicated npm run migrate script exists using prisma migrate deploy — Script: "prisma migrate deploy"
[PASS] One-off migration execution succeeds idempotently against test database — No pending migrations to apply.

--- Step 3: Multi-Stage Dockerfile Verification ---
[PASS] Dockerfile exists in api root
[PASS] .dockerignore exists in api root
[PASS] Dockerfile implements multi-stage build (builder -> runner)
[PASS] Dockerfile runs production container as non-root user
[PASS] Dockerfile specifies EXPOSE 3000 and CMD ["node", "dist/main"]

--- Step 4: GitHub Actions CI Pipeline Verification ---
[PASS] GitHub Actions ci.yml exists at .github/workflows/ci.yml
[PASS] CI workflow defines PostgreSQL and Redis service containers
[PASS] CI workflow runs one-off prisma migrate deploy before tests
[PASS] CI workflow runs test suite and build

--- Step 5: Server Dynamic PORT & 0.0.0.0 Host Binding ---
[PASS] Server explicitly binds to 0.0.0.0 in main.ts
[PASS] Server explicitly enables NestJS graceful shutdown hooks in main.ts
Spawning test API server on dynamic PORT=3110...
[PASS] Server booted successfully on dynamic PORT=3110

--- Step 6: Liveness & Readiness Probes Verification ---
[PASS] GET /health returns HTTP 200 { ok: true } (Liveness probe) — {"ok":true}
[PASS] GET /ready returns HTTP 200 with db: ok and redis: ok (Readiness probe) — {"ok":true,"status":"ready","db":"ok","redis":"ok"}
[PASS] GET /health/ready alias returns HTTP 200 matching /ready

--- Step 7: Readiness Negative Drill (Dependency Outage) ---
[PASS] Secondary server booted with broken DB configuration on PORT=3111
[PASS] GET /health still returns HTTP 200 during database outage (Liveness decoupling)
[PASS] GET /ready returns HTTP 503 within 1037ms when PostgreSQL is unreachable — {"ok":false,"status":"unready","db":"unreachable","redis":"ok"}

--- Step 8: Graceful Shutdown Lifecycle Verification ---
[PASS] Server gracefully terminated on SIGTERM in 44ms without hanging — Exit code: null, Signal: SIGTERM

====================================================================
MODULE 10 BUILD VERIFICATION RESULTS: 22 PASSED, 0 FAILED
====================================================================
```

All 13 Module 09 integration tests were rerun via `npm test` and passed with 0 failures:
- Create Link & Tag normalization (201)
- Redirect correctness with Location header (302)
- JWT 401 authentication protection
- IDOR 404 cross-owner isolation and database row immutability
- 30-day analytics retention purge
- 7/7 URL validation attack strings rejected (400)
- Analytics idempotent processing (`P2002` deduplication)
- Zero mutation of development database `upsk_sdf` or Redis DB 0

---

## 5. Summary of Deliverables & Generated Artifacts

- Dockerfile: [Dockerfile](file:///D:/Knack%20labs/api/Dockerfile)
- Dockerignore: [.dockerignore](file:///D:/Knack%20labs/api/.dockerignore)
- CI Workflow: [ci.yml](file:///D:/Knack%20labs/.github/workflows/ci.yml)
- Docker Build Evidence: [docker-build.txt](file:///D:/Knack%20labs/progress/evidence/module-10/docker-build.txt)
- Health & Readiness Test Output: [health-readiness-tests.txt](file:///D:/Knack%20labs/progress/evidence/module-10/health-readiness-tests.txt)
- Graceful Shutdown Output: [graceful-shutdown.txt](file:///D:/Knack%20labs/progress/evidence/module-10/graceful-shutdown.txt)
- Migration Deployment Evidence: [migration-deploy.txt](file:///D:/Knack%20labs/progress/evidence/module-10/migration-deploy.txt)
- CI Pipeline Evidence: [ci-pipeline.txt](file:///D:/Knack%20labs/progress/evidence/module-10/ci-pipeline.txt)
- Decision Tradeoff Report: [decision-analysis.md](file:///D:/Knack%20labs/progress/evidence/module-10/decision-analysis.md)

