# Module 02 — Step 1: CONTEXT
**Topic:** The CI/CD Assembly Line vs. Manual Laptop Deploys

## Learner Reflections & Micro-Exercise Responses

### 1. Manual Pre-Push Routine
> Before pushing code, I usually check whether the application runs correctly, execute the available tests, verify TypeScript compilation, and review the changed files. Depending on the changes, I also check the Docker build. However, I may not always remember to perform every check manually.

### 2. Manual Reliability under Pressure
> If I had to repeat these steps 20 times a day under deadline pressure, there would be a high chance of missing something. Automated CI helps by consistently running builds, tests, linting, and other checks whenever code is pushed, reducing human errors and preventing broken code from moving forward.

## Core Architectural Concepts
- **Continuous Integration (CI):** Automates quality gates (linting, static type analysis, automated test suites) on every branch and PR commit to detect regressions at the earliest possible stage.
- **Continuous Delivery (CD):** Automates the packaging and artifact delivery (building container images, tagging with immutable git commit SHAs, pushing to container registry) independently of manual developer environments.
- **Git as Single Source of Truth:** The pipeline builds strictly from committed Git refs, eliminating the "works on my machine" hazard caused by dirty local working trees or uncommitted secrets.
