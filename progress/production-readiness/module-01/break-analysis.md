# Module 01 — Step 5: BREAK Analysis

## 1. Symptom Diagnosis
- **Symptom A (Slow Rebuilds):** Rebuilding after modifying a single line/comment triggers a full dependency reinstall, turning a 2-second cached build into a multi-minute build.
- **Symptom B (Sensitive Files in Image):** Inspecting image layers reveals `.env` files, `.git` histories, and local build artifacts inside the container.

## 2. Technical Root Cause

### Defect 1: Layer Cache Invalidation Due to Instruction Inversion
```dockerfile
# BROKEN INSTRUCTION ORDER:
COPY . .
RUN pnpm install --frozen-lockfile
```
- When `COPY . .` is placed before the dependency installation command, any modification to a single source code file alters the checksum of that `COPY` step.
- Docker treats any changed layer as a cache miss, immediately invalidating all subsequent layers.
- Consequently, `pnpm install` cannot use Docker's layer cache and must execute from scratch on every commit or minor edit.

### Defect 2: Missing or Incomplete `.dockerignore` Context Boundary
- If `.dockerignore` is absent or fails to exclude `.env*` and `.git/`, Docker sends the entire directory tree across the daemon socket.
- `COPY . .` bakes raw environment secrets and development git history directly into the immutable image layer, exposing credentials to anyone who pulls or inspects the image.

## 3. Correct Pattern
1. Copy **only** package manifests first:
   ```dockerfile
   COPY package.json pnpm-lock.yaml ./
   RUN pnpm install --frozen-lockfile
   COPY . .
   ```
2. Maintain a strict `.dockerignore` blocking `.env*`, `.git`, `node_modules`, and test directories.
