# Module 01 — Step 3: BUILD Verification Report

## 1. Multi-Stage Dockerfile Architecture
The API Gateway was packaged into a production-grade multi-stage container using `node:20-slim`:

```dockerfile
# Stage 1: Builder
FROM node:20-slim AS builder
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

# Stage 2: Runtime
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN groupadd -r appgroup && useradd -r -g appgroup -s /bin/false appuser
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/live || exit 1
CMD ["node", "dist/main"]
```

## 2. Security Hardening
- **Unprivileged Execution:** Runs under `appuser:appgroup` created without login shell (`/bin/false`) and with no root privileges.
- **Context Exclusion (.dockerignore):** Explicitly ignores `.git`, `.env`, local `node_modules`, test suites, build caches, and coverage artifacts, preventing credential leakage and build context bloat.
- **Native Health Check:** Integrated `HEALTHCHECK` probing `GET /live` with 30s intervals and 3 retries.

## 3. Empirical Verification
- **Build Result:** Image `myservice:latest` compiled cleanly.
- **Image Size:** 525MB (including glibc runtime, Prisma engine binaries, and production node_modules).
- **Liveness Probe:** Verified with `docker run`:
  `curl http://localhost:3000/live` -> `HTTP 200 {"ok":true}`
