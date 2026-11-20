# Module 02 — Step 5: BREAK Analysis

## Symptom Investigation & Root Cause Identification

### 1. Symptom 1: Secret Exposure via Insecure Debug Echoes
- **Observed Defect:** Developers frequently insert debugging steps like `echo "Using token: $REGISTRY_TOKEN"` or print raw environment blobs.
- **Root Cause:** Direct shell echoing of secret environment variables bypasses platform masking if transformed or concatenated, dumping sensitive authentication credentials into build logs accessible across the organization.
- **Impact:** Immediate credential compromise requiring token revocation and rotation.

### 2. Symptom 2: 3–4x Pipeline Slowdown (Cache Miss / Path Invalidation)
- **Observed Defect:** Pipeline runtime increases from ~1 minute to over 4 minutes despite zero dependency changes.
- **Root Cause:** Misconfigured cache key or incorrect `cache-dependency-path` (e.g., pointing to `./pnpm-lock.yaml` instead of `api/pnpm-lock.yaml`, or using volatile cache keys). When the runner cannot locate the lockfile, it fails to restore cached dependencies, forcing a complete cold network install of all packages and tools on every run.

### 3. Symptom 3: Unintended Feature Branch Image Publishing
- **Observed Defect:** Pushing an experimental commit to a feature branch (`feat/test-experiment`) triggers a Docker build and pushes images to the container registry.
- **Root Cause:** Omission of the conditional branch execution gate (`if: github.ref == 'refs/heads/main'`) on the `push` job.
- **Impact:** Registry pollution with unstable, untested development images and heightened risk of staging/production clusters pulling an experimental tag.
