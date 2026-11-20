# Module 01 — Step 7: REFLECT
**Topic:** Containerization Quality & Production Hardening

## Learner Reflections

### 1. Base Image Decision
> I would keep Debian Slim because it provides better compatibility with native Node.js dependencies and makes debugging easier. I would choose Alpine for lightweight services where image size, faster deployments, and reduced attack surface are priorities, provided all dependencies are compatible with musl.

### 2. Docker Layer Caching & Build Speed
> The BREAK exercise demonstrated that Docker reuses cached layers when the instructions and their dependent files have not changed. If we copy the entire source code before installing dependencies, even a small source-code change can invalidate the dependency installation layer.
>
> A better approach is to copy package.json and the lockfile first, install dependencies, and then copy the application source code. This allows Docker to reuse dependency layers and reduces CI build time.

### 3. Containerization vs Direct Deployment
> I would explain that copying files using SCP and running Node.js directly can create environment differences between development and production machines. Containers package the application with its runtime and dependencies, providing an isolated and reproducible environment. They also make deployment, scaling, rollback, and maintenance more consistent.

---

## Retrospective Summary
- **Outcome:** Hardened `Dockerfile` with multi-stage separation (`builder` vs `runner`), unprivileged `appuser` execution, native `HEALTHCHECK`, and comprehensive `.dockerignore` context boundary.
- **Empirical Proof:** `myservice` running non-root, `/live` probe operational, sub-second cached rebuilds restored.
