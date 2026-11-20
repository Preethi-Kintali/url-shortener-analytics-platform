# Operations Manual: Service Overview

## 1. Purpose
The URL Shortener & Real-Time Analytics Platform provides low-latency URL redirection with singleflight caching, collision-resistant Base62 short-code generation, and authenticated link management. It ingests click streams asynchronously into a background worker queue while exposing real-time Prometheus telemetry, circuit breakers, and deep health probes.

---

## 2. Backing Dependencies & Failure Policies

| Dependency | Type | What Happens Without It | Module 06 Fallback Mechanism |
|---|---|---|---|
| **PostgreSQL (v16)** | Primary Datastore (Prisma) | Auth fails, link creation/editing fails, uncached lookups fail | Circuit breaker opens after 5 failures (`circuit_opened`). Uncached lookups return HTTP 503 (`TEMPORARY_UNAVAILABLE`) in <1ms without hanging connection pools. Existing cached lookups continue serving from Redis. |
| **Redis (v7-Alpine)** | In-Memory L1 Cache & Queue Store | Cache lookups miss, BullMQ enqueueing stalls | Degraded operation: Cache misses bypass Redis and fall back directly to PostgreSQL. Non-critical analytics click event failures are caught and dropped, ensuring HTTP 302 redirects succeed. |
| **BullMQ Worker** | Background Analytics Queue | Asynchronous click metrics processing halts | Decoupled from redirect ingress: Click events are enqueued asynchronously; worker failures do not degrade redirect response times or link creation. |
| **Docker Host / Ingress Network** | Container Runtime & Virtual Network | Service unreachable from external clients | Docker healthcheck monitors `/live`; if host networking fails, health probes fail, triggering load balancer removal. |

---

## 3. Exposed Endpoints

### Operational & Telemetry Endpoints
- `GET /live`: Native liveness probe. Returns HTTP 200 `{"ok":true}` if Node.js event loop is running. Never checks dependencies.
- `GET /ready`: Deep readiness probe. Returns HTTP 200 if PostgreSQL and Redis are both reachable; returns HTTP 503 `{"ok":false,"status":"degraded"}` if any critical dependency is partitioned.
- `GET /metrics`: Standard Prometheus metrics export (`http_requests_total`, `http_request_duration_seconds`, `active_connections`, `urls_total`).

### Business & Domain Endpoints
- `POST /auth/login`: Authenticates API clients via JSON credentials and issues signed JWT bearer tokens.
- `POST /links`: Creates a new shortened URL with Base62 collision avoidance and optional custom tags/expiration.
- `GET /links`: Lists and searches paginated URLs owned by the authenticated principal.
- `GET /links/:id`: Retrieves link details, destination URL, and tag metadata by unique link ID.
- `PATCH /links/:id`: Updates destination URL and tag metadata, triggering post-commit cache invalidation.
- `DELETE /links/:id`: Deletes short link and immediately purges Redis redirect cache.
- `GET /r/:code`: High-throughput redirect endpoint resolving short codes to target URLs with HTTP 302.
- `GET /analytics/:code`: Queries aggregated click analytics, referrer distributions, and time-series metrics.

---

## 4. Configuration & Runtime Environment

Reference: [.env.example](../api/.env.example)

| Variable | Operational Role | Safe at Runtime? | Restart Required? |
|---|---|---|---|
| `PORT` | HTTP listener port | No | Yes (process re-bind) |
| `DATABASE_URL` | PostgreSQL connection string | No | Yes (Prisma Client pool init) |
| `REDIS_URL` | Redis connection string | No | Yes (ioredis socket connect) |
| `JWT_SECRET` | 256-bit secret for JWT signature verification | No | Yes (token validation cache) |
| `NODE_ENV` / `APP_ENV` | Environment mode (`development`, `staging`, `production`) | No | Yes (NestJS DI bootstrap) |
| `LOG_LEVEL` | Logging verbosity filter (`debug`, `info`, `warn`, `error`) | Yes (dynamic logger reload) | No |
| `CIRCUIT_RESET_TIMEOUT_MS` | Breaker half-open recovery delay (default: 30000ms) | Yes (read on breaker creation) | No |
| `RATE_LIMIT_TTL_MS` | Ingress throttler sliding window (default: 60000ms) | No | Yes |

---

## 5. Deployment Protocol (Exact Copy-Paste Commands)

### Automated Pipeline Deployment
Pushes or pull-request merges to the `main` branch automatically trigger GitHub Actions workflow [.github/workflows/ci.yml](../.github/workflows/ci.yml).
Pipeline gates: Lint $\to$ Unit Tests $\to$ Container Image Build $\to$ Git SHA Tagging.

### Manual / Local Container Deployment
```powershell
# 1. Build immutable production image tagged with current commit SHA
$COMMIT_SHA = (git rev-parse --short HEAD)
docker build -t myservice:$COMMIT_SHA -t myservice:latest "D:\Knack labs\api"

# 2. Run new production container
docker run -d `
  --name myservice-prod `
  --restart unless-stopped `
  -p 3000:3000 `
  --env-file "D:\Knack labs\api\.env" `
  myservice:$COMMIT_SHA
```

### Deployment Verification
```powershell
# Step 1: Verify process liveness
curl -s http://localhost:3000/live
# Expected: {"ok":true}

# Step 2: Verify deep dependency readiness
curl -s http://localhost:3000/ready
# Expected: {"ok":true,"status":"ok","checks":{"database":"connected","cache":"connected"}}

# Step 3: Verify metrics scrape
curl -s http://localhost:3000/metrics | Select-String "http_requests_total"
# Expected: # HELP http_requests_total Total number of HTTP requests
```

---

## 6. Rollback Protocol (Exact Copy-Paste Commands)

When deployment exhibits regression (HTTP 500 spike or failed readiness probe):

```powershell
# 1. Stop and remove the malfunctioning container
docker stop myservice-prod
docker rm myservice-prod

# 2. Run the previously verified commit SHA image (inspect previous git commit)
$PREV_SHA = (git rev-parse --short HEAD~1)
docker run -d `
  --name myservice-prod `
  --restart unless-stopped `
  -p 3000:3000 `
  --env-file "D:\Knack labs\api\.env" `
  myservice:$PREV_SHA

# 3. Verify rollback health
curl -s http://localhost:3000/live
curl -s http://localhost:3000/ready
# Expected: Both return HTTP 200 with status "ok"
```

---

## 7. Operational Ownership & Escalation

- **Owning Team:** Core Platform & Reliability Engineering
- **Slack Operations Channel:** `#ops-url-shortener`
- **Escalation SLA Matrix:**
  - **Primary On-Call:** Dedicated On-Call Engineer (PagerDuty: `url-shortener-p1`) — Response SLA: 5 minutes.
  - **Secondary On-Call:** Systems Architect / Senior Backend Engineer — Response SLA: 10 minutes if primary unacknowledged.
  - **Engineering Lead:** Engineering Manager / Platform Director — Escalated if incident unresolved after 20 minutes.
