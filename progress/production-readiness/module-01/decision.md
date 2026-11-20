# Module 01 — Step 2: DECIDE
**Choice:** Option B — Debian Slim (`node:20-slim`)

## Learner Rationale
> I choose Debian Slim because it provides better compatibility with native Node.js dependencies and libraries that rely on glibc. Since my project uses Prisma, compatibility and easier debugging are more important than having the smallest possible base image. I can optimize the image using multi-stage builds.

## Exclusion of Build Tools in Production
> Build tools and development dependencies are only required during development and compilation. The production container should contain only the compiled application, production dependencies, and required runtime files. This reduces image size, attack surface, and unnecessary resource usage.

## Recorded Configuration
- `decisions.module_01.base_image`: `debian_slim`
- `decisions.module_01.build_strategy`: `multi_stage`
