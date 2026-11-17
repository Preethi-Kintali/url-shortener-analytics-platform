# Scalable URL Shortener & Real-Time Analytics Platform

A high-throughput, production-grade URL shortening and asynchronous click-tracking platform built with **NestJS**, **TypeScript**, **PostgreSQL**, **Redis**, and **BullMQ**. Designed with systems design principles prioritizing low-latency redirects, cache-aside acceleration, zero-downtime rolling deployment primitives, and defense-in-depth security.

Developed and validated as part of the **Upsk System Design Fundamentals – Practitioner & Operator Pack** (Modules 01–10 completed).

---

## Architecture Overview

The system decomposes into independent architectural tiers to isolate high-frequency read traffic from asynchronous analytics writes and background batch processing.

```mermaid
flowchart TD
    Client["Client / User"] --> Ingress["Ingress / Reverse Proxy"]
    
    subgraph "Application Layer"
        Ingress -->|"HTTP /r/:code (Public Redirects)"| API["NestJS HTTP API (Port 3000)"]
        Ingress -->|"HTTP /links (Auth CRUD & Search)"| API
        API -->|"Cache Miss / Authoritative Reads"| DB[(PostgreSQL 16)]
        API -->|"Cache-Aside (Hit / Miss / Invalidate)"| RedisCache[("Redis 7 Cache (DB 0)")]
        API -->|"Async Enqueue (Fail-Open Guard)"| Queue[("Redis 7 Queue Broker (BullMQ)")]
    end
    
    subgraph "Background Processing Layer"
        Worker["BullMQ Worker (worker.ts)"] -->|"Polls & Drains Jobs"| Queue
        Worker -->|"Idempotent Click Writes (UUID + P2002)"| DB
    end
```

### Key Architectural Characteristics
- **Read Path Optimization:** Public redirect requests (`GET /r/:code`) perform cache-aside lookups in Redis. On cache hits, the redirect response (`HTTP 302 Found`) resolves in sub-10ms without hitting the primary database.
- **Write Path Decoupling:** Clicks are not written synchronously to PostgreSQL during the redirect. Instead, the API enqueues a sanitized click event payload to BullMQ with a 250ms fail-open timeout, guaranteeing that slow database writes or queue backlogs never increase redirect latency.
- **Asynchronous Worker:** A standalone worker process (`src/worker.ts`) consumes click events, hashes client IP addresses using keyed HMAC-SHA256 for privacy compliance, and persists records with UUID-based idempotency to guarantee exactly-once analytics semantics.

---

## Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| **API Framework** | NestJS 10 (Express) | Modular enterprise architecture, dependency injection, lifecycle hooks |
| **Language** | TypeScript 5.x / Node.js 20 | Static type safety, modern async/await concurrency |
| **Primary Database** | PostgreSQL 16 | ACID guarantees, unique B-Tree indexes, relational analytics schemas, `pg_trgm` FTS |
| **ORM & Migrations** | Prisma 5.x | Type-safe query generation, deterministic schema migrations (`prisma migrate deploy`) |
| **Caching Layer** | Redis 7 (ioredis) | Sub-millisecond in-memory cache-aside lookups with TTL jitter |
| **Job Queue** | BullMQ | Reliable Redis-backed queue with exponential retry backoff and dead-letter handling |
| **Authentication** | JWT (jsonwebtoken) | Stateless HS256 tokens (15-min TTL), owner-scoped query filtering |
| **Containerization** | Docker (Alpine Linux) | Multi-stage build (406MB footprint), non-root security context (`USER nestjs`) |
| **CI Automation** | GitHub Actions | Automated build, type-check, schema migrations, and integration test suite |

---

## Key Features

1. **High-Speed Redirect Engine (`/r/:code`)**
   - Base62 / alphanumeric short codes mapped to authoritative database URLs.
   - Redis cache-aside lookup with randomized TTL jitter (270–330 seconds) to prevent cache stampedes.
   - Fallback to PostgreSQL on cache miss with automatic cache population.

2. **Decoupled Asynchronous Analytics**
   - Click events enqueued via BullMQ with fail-open safety (if Redis is slow or down, the redirect still succeeds immediately).
   - Dedicated consumer worker running separately from HTTP API pods.
   - Keyed HMAC-SHA256 IP hashing ensuring GDPR/privacy compliance with no raw IP persistence.
   - Deduplication protection backed by PostgreSQL `UNIQUE(idempotency_key)` handling (`P2002`).

3. **Multi-Tenant Ownership & IDOR Protection**
   - Link management routes (`POST /links`, `GET /links`, `PATCH /links/:id`, `DELETE /links/:id`) protected by JWT authentication.
   - Direct query-level scoping: all write/read operations enforce `where: { id: linkId, createdBy: principalId }`, preventing Insecure Direct Object References (IDOR).

4. **PostgreSQL Full-Text Search & Pagination**
   - Indexed URL substring, short code, and tag search powered by `pg_trgm` and GIN indexing.
   - Bounded cursor/offset pagination (`page`, `page_size` strictly capped at 100) preventing query-memory exhaustion.

5. **Production Reliability & Orchestration Primitives**
   - Decoupled **Liveness** (`GET /health`) returning immediate in-memory 200 OK without downstream I/O.
   - Decoupled **Readiness** (`GET /ready`) checking live PostgreSQL `SELECT 1` and Redis `PING`.
   - Graceful termination handling (`SIGTERM`) via NestJS `app.enableShutdownHooks()`.
   - Out-of-band database schema migrations via `prisma migrate deploy`.

---

## Database Schema & Indexing Strategy

Designed with relational normalization in PostgreSQL to avoid document bloat while maximizing index efficiency:

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  createdAt    DateTime @default(now()) @map("created_at")
  links        Link[]

  @@map("users")
}

model Link {
  id          String       @id @default(uuid())
  code        String       @unique
  shortUrl    String       @map("short_url")
  longUrl     String       @map("long_url")
  tags        String[]     @default([])
  createdBy   String       @map("created_by")
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @updatedAt @map("updated_at")
  user        User         @relation(fields: [createdBy], references: [id], onDelete: Cascade)
  clickEvents ClickEvent[]

  @@index([createdBy, createdAt(sort: Desc)])
  @@map("links")
}

model ClickEvent {
  id             String   @id @default(uuid())
  linkId         String   @map("link_id")
  clickedAt      DateTime @default(now()) @map("clicked_at")
  userAgent      String?  @map("user_agent")
  referrer       String?  @map("referrer")
  ipHash         String   @map("ip_hash")
  idempotencyKey String   @unique @map("idempotency_key")
  link           Link     @relation(fields: [linkId], references: [id], onDelete: Cascade)

  @@index([linkId, clickedAt(sort: Desc)])
  @@map("click_events")
}
```

### Specialized Indexes
- `Link.code` (`UNIQUE B-Tree`): Provides $O(\log N)$ lookup performance for short-code redirects.
- `ClickEvent(linkId, clickedAt DESC)`: Optimizes time-bucketed analytics queries without table scans.
- `ClickEvent.idempotencyKey` (`UNIQUE`): Enforces database-level idempotency against duplicate queue delivery.
- Trigram extension (`pg_trgm`) + GIN index on `Link.longUrl`: Enables performant substring searches across large link catalogs.

---

## Caching Strategy (Redis)

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant API as NestJS API
    participant Redis as Redis Cache
    participant DB as PostgreSQL

    Client->>API: GET /r/:code
    API->>Redis: GET link:code
    alt Cache Hit
        Redis-->>API: { long_url: "https://example.com" }
    else Cache Miss
        Redis-->>API: null
        API->>DB: SELECT * FROM links WHERE code = :code
        DB-->>API: Link Record
        API->>Redis: SETEX link:code 300s { long_url } (with jitter)
    end
    API-->>Client: HTTP 302 Found (Location: long_url)
```

- **Cache-Aside Pattern:** Reads check Redis first; on miss, the authoritative record is fetched from PostgreSQL and written to Redis with a TTL.
- **TTL Jitter:** Cache keys expire after $300 \pm 30$ seconds (randomized between 270s and 330s) to prevent bulk key expiration and cache stampedes.
- **Active Invalidation:** When a link is updated (`PATCH /links/:id`) or deleted (`DELETE /links/:id`), the API immediately purges the cached entry in Redis before committing the response, guaranteeing stale targets are never served.

---

## Asynchronous Analytics Architecture (BullMQ)

```mermaid
sequenceDiagram
    autonumber
    actor Visitor
    participant API as NestJS API
    participant Queue as BullMQ (Redis)
    participant Worker as Background Worker
    participant DB as PostgreSQL

    Visitor->>API: GET /r/:code
    API->>Queue: add('record-click', { eventId, linkId, ipHash, ua, ref }) [250ms guard]
    API-->>Visitor: HTTP 302 Found (Immediate redirect)
    
    Queue->>Worker: Dispatch Job
    Worker->>DB: INSERT INTO click_events (idempotency_key, ...)
    alt Unique Constraint Violation (P2002)
        Worker-->>Worker: Skip silently (Deduplication confirmed)
    else Success
        Worker-->>Queue: Mark Job Completed
    end
```

- **Fail-Open Enqueue Guard:** Queue insertion is wrapped in a 250ms timeout. If Redis is experiencing latency or memory pressure, the error is logged and the redirect resolves without failure.
- **Privacy Enforcement:** Client IPs are hashed with keyed HMAC-SHA256 before queue dispatch. Raw IP addresses never touch persistent storage or application log streams.
- **Worker Isolation:** The BullMQ worker executes in an isolated process (`dist/worker.js`), ensuring background processing failures or queue processing bursts do not impact API responsiveness.

---

## Production Reliability & Container Hardening

### Liveness vs. Readiness Decoupling
- **`GET /health` (Liveness):** Evaluates local in-memory event-loop responsiveness. Never calls PostgreSQL or Redis. If upstream services fluctuate, the container stays alive, preventing orchestrator crash-restart loops (`CrashLoopBackOff`).
- **`GET /ready` (Readiness):** Actively queries `SELECT 1` in PostgreSQL and `PING` in Redis. If a dependency is unreachable, it returns `HTTP 503 Service Unavailable`, instructing the ingress router to stop routing traffic to that instance until connectivity recovers.

### Multi-Stage Dockerfile Hardening
The container build (`api/Dockerfile`) implements enterprise container packaging practices:
1. **Builder Stage (`node:20-alpine AS builder`):** Installs full dependencies with Corepack/pnpm, generates Prisma client code, compiles TypeScript into `dist/`, and prunes development packages.
2. **Runner Stage (`node:20-alpine AS runner`):** Copies only compiled artifacts and production dependencies. Runs under a dedicated unprivileged user (`USER nestjs`, UID 1001).
3. **Dynamic Host Binding:** Server explicitly binds to `0.0.0.0` and respects dynamic container `PORT` allocation.
4. **Footprint:** Minimal 406MB container image.

---

## API Documentation

All administrative endpoints require a Bearer token in the `Authorization` header: `Authorization: Bearer <TOKEN>`.

### Authentication
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/auth/login` | Authenticate user credentials and receive a 15-minute JWT | No |

**Request Body (`/auth/login`):**
```json
{
  "email": "alice@example.com",
  "password": "dev-alice-secret-01"
}
```

### Public Redirect
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/r/:code` | Resolve short-code and redirect via HTTP 302 | No |

### Link Management (Protected)
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/links` | Create a new short link with optional custom code and tags | **Yes (JWT)** |
| `GET` | `/links` | List all links owned by the authenticated user | **Yes (JWT)** |
| `GET` | `/links/search` | Search owned links by URL substring, code, or tags with pagination | **Yes (JWT)** |
| `GET` | `/links/:id` | Get details for a specific owned link | **Yes (JWT)** |
| `PATCH` | `/links/:id` | Update destination URL or tags (triggers Redis cache invalidation) | **Yes (JWT)** |
| `DELETE` | `/links/:id` | Delete link and purge cache entry | **Yes (JWT)** |
| `GET` | `/links/:id/analytics` | Retrieve time-bucketed click statistics and total click count | **Yes (JWT)** |

### Health & Orchestration Probes
| Method | Endpoint | Description | Target |
|---|---|---|---|
| `GET` | `/health` | In-memory liveness probe (returns 200 OK) | Orchestrator Liveness Probe |
| `GET` | `/ready` | Downstream dependency readiness check (PostgreSQL + Redis) | Ingress Routing / Gateways |

---

## Environment Variables

Copy `.env.example` to `.env` and configure appropriate variables:

```bash
# Server Port & Runtime
PORT=3000
NODE_ENV=development

# Database Connection (PostgreSQL 16)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/upsk_sdf?schema=public"

# Redis Cache & BullMQ Broker
REDIS_URL="redis://localhost:6379/0"

# JWT Authentication Secret (Minimum 32 characters)
JWT_SECRET="replace-with-a-secure-random-32-char-secret-key"

# Analytics & Privacy
ANALYTICS_RETENTION_DAYS=30
ANALYTICS_IP_SALT="replace-with-a-secure-hmac-salt"
```

---

## Local Installation & Execution

### Prerequisites
- Node.js 20+ and pnpm (`corepack enable`)
- PostgreSQL 16
- Redis 7
- Docker (optional for containerized execution)

### 1. Clone & Install Dependencies
```bash
git clone <repository-url>
cd "Knack labs/api"
pnpm install
```

### 2. Run Database Migrations
```bash
# Run one-off migrations against local PostgreSQL
npm run migrate

# Generate Prisma client bindings
npx prisma generate
```

### 3. Start Development Services
```bash
# Terminal 1: Start HTTP API Server
pnpm run start:dev

# Terminal 2: Start Background Analytics Worker
pnpm run start:worker
```

### 4. Build & Run via Docker
```bash
# Build multi-stage production image
docker build -t bootcamp-api:latest .

# Run container on port 3000
docker run -d \
  --name bootcamp-api \
  -p 3000:3000 \
  -e PORT=3000 \
  -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/upsk_sdf?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379/0" \
  -e JWT_SECRET="your-32-char-jwt-secret-here" \
  bootcamp-api:latest
```

---

## Testing & Verification Suite

The repository includes comprehensive automated verification suites covering unit, integration, and operational failure behaviors:

```bash
# Run Module 10 deployment verification (22/22 checks)
npx ts-node scripts/verify-module-10.ts

# Run Module 09 integration-heavy test suite (27/27 checks)
npx ts-node scripts/verify-module-09.ts

# Run Module 08 database-native search verification (17/17 checks)
npx ts-node scripts/verify-module-08.ts

# Run Module 07 background queue & analytics verification (23/23 checks)
npx ts-node scripts/verify-module-07.ts

# Run Module 06 Redis cache-aside verification (19/19 checks)
npx ts-node scripts/verify-module-06.ts

# Run Module 04 auth & rate-limiting verification (31/31 checks)
npx ts-node scripts/verify-module-04.ts
```

All test suites enforce pre-flight environment guards targeting `upsk_sdf_test` and Redis DB 1, preserving production and development data stores.

---

## Empirical Failure Drills & Evidence

As part of the system design verification protocol, controlled architectural experiments were conducted and logged:

### 1. Dependency Outage BREAK Experiment
- **Injected Failure:** Reconfigured container `DATABASE_URL` to an unreachable port (`5439`).
- **Observed Behavior:**
  - Liveness probe (`/health`) returned **HTTP 200 OK** in 96ms (in-memory response maintained).
  - Readiness probe (`/ready`) returned **HTTP 503 Service Unavailable** in 343ms with `db: "unreachable"`.
- **Evidence Log:** [`progress/evidence/module-10/break-repro-log.txt`](progress/evidence/module-10/break-repro-log.txt)

### 2. Operational FIX & Recovery
- **Remediation:** Restored correct PostgreSQL host endpoint on port 5432.
- **Observed Behavior:**
  - Container readiness restored immediately to **HTTP 200 OK** (`db: "ok"`, `redis: "ok"`).
- **Evidence Log:** [`progress/evidence/module-10/fix-verification-report.md`](progress/evidence/module-10/fix-verification-report.md)

### 3. Graceful Termination (SIGTERM Drill)
- **Experimental Setup:** Initiated an active HTTP request to an isolated container immediately before issuing `docker stop` (SIGTERM).
- **Observed Behavior:**
  - Request initiated before termination received **HTTP 200 OK** without socket reset (`ECONNRESET`).
  - Container exited cleanly with **Exit Code 0** in approximately 733ms.
  - Active PostgreSQL connection counts (`pg_stat_activity`) decreased from 2 to 1; Redis connections decreased from 4 to 2.
- **Evidence Log:** [`progress/evidence/module-10/graceful-shutdown-drill.txt`](progress/evidence/module-10/graceful-shutdown-drill.txt)

### 4. End-to-End Final Reference Demo
- Complete 7-step reference demo script covering liveness/readiness, authentication, link creation, 302 redirects, BullMQ worker analytics processing, cache invalidation, search pagination, and graceful shutdown.
- **Evidence Log:** [`progress/lab-notebook.md`](progress/lab-notebook.md)

---

## Project Structure

```text
Knack labs/
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI pipeline configuration
├── api/
│   ├── Dockerfile               # Multi-stage production container definition
│   ├── .dockerignore            # Container build exclusions
│   ├── package.json             # Service dependencies and scripts
│   ├── prisma/
│   │   ├── schema.prisma        # Authoritative PostgreSQL schema
│   │   └── migrations/          # Version-controlled SQL migration steps
│   ├── scripts/                 # Automated verification suites & failure drills
│   └── src/
│       ├── main.ts              # Server bootstrap, 0.0.0.0 binding & shutdown hooks
│       ├── worker.ts            # Standalone BullMQ analytics worker entrypoint
│       ├── analytics/           # BullMQ queue services, worker logic & IP hashing
│       ├── auth/                # JWT authentication guards & login controllers
│       ├── cache/               # Redis cache-aside service with TTL jitter
│       ├── common/              # Structured logging, redaction & exception filters
│       ├── health/              # Decoupled /health and /ready probe controllers
│       ├── links/               # Link CRUD, validation pipes & search service
│       └── redirect/            # High-throughput public redirect controller
└── progress/
    ├── lab-notebook.md          # Reference final demo execution transcript
    ├── state.json               # Upsk skill completion records
    └── evidence/                # Verification reports and empirical drill logs
```

---

## Known Limitations & Production Roadmap

- **Deployment Scope:** CI workflows and Docker container behaviors are empirically validated through local automated pipelines and container drills. A live Railway cloud deployment or remote GitHub Actions run was not provisioned as part of this local engineering track.
- **Distributed Tracing:** Current logging uses structured JSON with correlation IDs (`X-Request-Id`). Integrating OpenTelemetry tracing would provide distributed spans between HTTP API calls and background BullMQ worker jobs.
- **Rate Limiting Granularity:** In-memory rate limiting is currently applied per node. In a multi-replica cluster, migrating to a Redis-backed sliding window rate limiter would provide cluster-wide protection against abuse.
- **Dedicated Search Engine:** PostgreSQL trigram search provides strong consistency and simplicity for medium link volumes. For multi-million link catalogs, synchronizing to a dedicated search cluster (e.g., Elasticsearch or Meilisearch) would be the next architectural evolution.

