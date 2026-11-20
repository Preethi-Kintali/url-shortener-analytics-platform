# Module 02 — Step 7: REFLECT
**Topic:** Pipeline Architecture, Secret Hygiene, and Delivery Risk

## Learner Reflections

### 1. CI Platform Reflection
> I would keep GitHub Actions because it integrates directly with GitHub and supports parallel jobs, caching, and automated Docker builds. Setting up the workflow stages and job dependencies was straightforward. The most challenging part was handling secrets securely and ensuring that image publishing happens only after all required checks pass.

### 2. The Most Dangerous Failure Mode
> I think leaking long-lived secrets is one of the most dangerous CI/CD failures because attackers could use those credentials to access infrastructure or sensitive services. Deploying untested code is also risky, so pipelines must enforce proper validation before deployment.

### 3. Business & Engineering Impact of Pipeline Latency
> A 15-minute pipeline slows down development and interrupts the feedback loop. Developers may avoid running checks or combine multiple changes to save time. During incidents, slower pipelines also delay fixes and increase Mean Time to Recovery (MTTR).

### 4. Secret Hygiene in Automation
> Secrets should be stored in secure CI/CD secret managers or environment-specific secret stores, never hardcoded in source code. Debug logs must not expose credentials, and sensitive files should be excluded from Git. Teams should also rotate credentials regularly and remove accidentally committed secrets from the repository history.

---

## Retrospective Summary
- **Outcome:** Hardened `.github/workflows/ci.yml` featuring parallel `lint` and `test` jobs, upstream-gated `build` (`needs: [lint, test]`), 15-minute timeouts, commit SHA image tagging (`2fb26c6`), and branch-restricted publication (`if: github.ref == 'refs/heads/main'`).
- **Empirical Proof:** Local artifact export drill (`artifacts/myservice-2fb26c6.tar`, ~123MB), zero secret leakage in logs, deterministic gating against broken tests.
