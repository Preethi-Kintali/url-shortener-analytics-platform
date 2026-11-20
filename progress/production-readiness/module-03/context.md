# Module 03 — Step 1: CONTEXT
**Topic:** Environment Management & Strict Configuration Boundaries

## Learner Reflections & Micro-Exercise Responses

### 1. Configuration Variable Classification
- **`DATABASE_URL` (Must Change):** Development, staging, and production must target completely disjoint persistence clusters to eliminate cross-environment corruption.
- **`REDIS_URL` (Must Change):** Isolated Redis brokers prevent staging cache invalidation from flushing production keys or sharing queue workers.
- **`JWT_SECRET` (Must Change):** Distinct cryptographic keys prevent dev/staging tokens from authenticating against production APIs.
- **`PORT` (Can Remain Same):** Bounded by container internal listening port (default `3000`), mapped dynamically by ingress orchestrators.
- **`LOG_LEVEL` (Can Differ):** Verbose `debug` logging in development vs signal-dense `info`/`warn` in production to prevent disk saturation and log noise.

### 2. The "Day 1 Developer" Test & Fail-Fast Principle
> The service should fail immediately with a clear error message listing all missing required environment variables. Silent defaults can hide configuration mistakes and may accidentally connect to the wrong database or use insecure secrets. Fail-fast validation makes setup easier to debug and prevents unsafe deployments.

## Core Architectural Guardrails
- **Twelve-Factor Configuration (Factor III):** Strict separation of config from code. Immutable container images parameterized strictly via environment variables injected at runtime.
- **Fail-Fast Startup Schema:** Pre-flight validation executed before opening network listeners or initializing database pools. If any required variable is missing or malformed, exit immediately (`process.exit(1)`) with structured failure diagnostics.
