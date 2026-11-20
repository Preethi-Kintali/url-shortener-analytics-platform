# Module 02 — Step 2: DECIDE
**Choice:** Option A — GitHub Actions (with Parallel Pipeline Shape)

## Learner Rationale

### 1. CI Platform Selection
> I choose GitHub Actions because my project is hosted on GitHub, so it provides native repository integration. It supports automated workflows, reusable actions, dependency caching, and Docker builds without requiring a separate CI platform.

### 2. Pipeline Stage Shape
> I prefer a parallel pipeline where linting and testing run concurrently, followed by the build and push stages. Since linting and testing are independent checks, running them together saves time. The build and push stages should execute only after the required checks pass.

## Recorded Architecture
- `decisions.module_02.ci_platform`: `github_actions`
- `decisions.module_02.pipeline_shape`: `parallel`
- Topology:
  ```
  [Push / PR] ──┬──> [Lint Job] ──────┐
                └──> [Test Job] ──────┴──> [Build & Push Docker Image] (needs: [lint, test])
  ```
