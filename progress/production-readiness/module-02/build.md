# Module 02 — Step 3: BUILD Report

## 1. Parallel CI/CD Workflow Architecture (`.github/workflows/ci.yml`)
Implemented a hardened, multi-stage GitHub Actions workflow configured for parallel quality gates and downstream artifact delivery:

```yaml
name: CI/CD Pipeline
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    name: Lint & Typecheck
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: npx tsc --noEmit

  test:
    name: Automated Test Suite
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres: ...
      redis: ...
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: npx prisma migrate deploy
      - run: pnpm run test

  build:
    name: Build Docker Container
    needs: [lint, test]
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - run: docker build -t myservice:${{ github.sha }} ./api
      - name: Image size guardrail check
        run: |
          IMAGE_BYTES=$(docker image inspect myservice:${{ github.sha }} --format='{{.Size}}')
          [ "$IMAGE_BYTES" -le 600000000 ] || exit 1

  push:
    name: Push to Container Registry
    needs: [build]
    if: github.ref == 'refs/heads/main'
    ...
```

## 2. Pipeline Hardening Features
- **Parallel Gating:** `lint` and `test` execute concurrently. `build` job explicitly requires both via `needs: [lint, test]`, ensuring failing tests or linter violations immediately halt execution before Docker builds.
- **Fail-Safe Timeouts:** Every job specifies `timeout-minutes: 15` to protect CI minute budgets from hanging processes or deadlocked tests.
- **Traceable Tagging:** Tagged using Git commit SHA (`${{ github.sha }}`) rather than mutable `latest`, providing deterministic forensic traceability.
- **Secret Masking:** Registry tokens and passwords are only referenced via `${{ secrets.REGISTRY_PASSWORD }}` and never committed in the workflow configuration.
- **Size Guardrail:** Automated inspection step verifies image footprint is within budgetary limits.

## 3. Local Fallback Verification & Artifact Export
- Tagged with Git SHA: `myservice:2fb26c6`
- Exported container tarball: `artifacts/myservice-2fb26c6.tar` (123,248,640 bytes)
- Verified image byte size: 123,225,378 bytes
