# Module 01 — Step 4: VERIFY Report

## Verification Checklist Results

| Check | Command | Observed Output | Status |
| :--- | :--- | :--- | :--- |
| **1. Build Completion** | `docker build -t myservice ./api` | Clean multi-stage build, layers cached, tagged `myservice:latest` | **PASS** |
| **2. Non-Root Process** | `docker exec myservice-test whoami` | `appuser` (UID unprivileged, `/bin/false` shell) | **PASS** |
| **3. Liveness Probe** | `curl http://localhost:3000/live` | `{"ok":true}` (HTTP 200, fast process check) | **PASS** |
| **4. Readiness Probe** | `curl http://localhost:3000/ready` | `{"ok":false,"status":"unready","db":"unreachable","redis":"unreachable"}` | **PASS** |
| **5. Image Size** | `docker images myservice --format "{{.Size}}"` | `525MB` (Production Debian Slim + NestJS + Prisma engines) | **VERIFIED** |

## Key Conceptual Takeaways
- **Layer Caching:** Docker computes checksums for each instruction. If `COPY . .` occurs before dependency installation, every source edit invalidates subsequent layers. Isolating `COPY package.json` and lockfiles before `pnpm install` ensures dependency layers stay cached during code changes.
- **Liveness vs. Readiness:** Liveness (`/live`) confirms the Node event loop is unblocked and responsive; readiness (`/ready`) verifies dependency connectivity. During startup, orchestrators keep traffic off unready pods without killing them.
- **Unprivileged Blast Radius:** Running as `appuser` prevents attackers from exploiting application vulnerabilities to modify container system files or mount host escapes.
