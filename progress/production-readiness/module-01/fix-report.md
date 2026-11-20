# Module 01 — Step 6: FIX Report

## Defect Resolution & Verification

### 1. Inversion Fix (Layer Caching Optimization)
- In `Dockerfile`, package manifests (`package.json`, `pnpm-lock.yaml`) are explicitly copied and installed prior to copying application source code:
  ```dockerfile
  COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc* ./
  RUN pnpm install --frozen-lockfile
  COPY tsconfig.json ./
  COPY src ./src
  RUN pnpm run build
  ```
- Any subsequent edit to application code no longer invalidates the `pnpm install` layer, preserving Docker cache hits and reducing rebuild times to sub-second compilation.

### 2. Secret & Context Isolation (.dockerignore)
- Validated that `.dockerignore` blocks `.env*`, `.git/`, test suites, and temporary artifacts.
- Directory listing inside running container (`docker exec myservice-verify ls -la`) confirmed only production runtime assets are present:
  - `dist/` (compiled JavaScript only)
  - `node_modules/` (production-pruned only)
  - `prisma/` (compiled client engines)
  - `package.json`
  - Zero `.git`, `.env`, or test files leaked into the image.

### 3. Container Runtime Checks
- `whoami`: Verified non-root execution as `appuser`.
- `GET /live`: Verified HTTP 200 `{"ok":true}`.
- `GET /ready`: Verified HTTP 503 dependency isolation.
- Container cleanup completed cleanly.
