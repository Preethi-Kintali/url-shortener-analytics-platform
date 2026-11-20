# Module 03: Environment Management - Architectural Decision

## 1. Secret Management Decision
- **Selected Choice:** Option A – Platform Environment Variables (`platform_env`)
- **Reasoning:**
  I choose platform environment variables because they are simple to manage and supported by platforms like GitHub Actions, AWS ECS, Railway, and other deployment providers. They avoid additional infrastructure and are sufficient for our current service. For larger production systems with compliance or automated key-rotation requirements, a dedicated secret manager (e.g. AWS Secrets Manager or Vault) can be introduced.

## 2. Configuration Approach Decision
- **Selected Choice:** Option A – Single Validated Config Module with Environment Variable Overrides (`env_overrides`)
- **Reasoning:**
  I prefer a single validated configuration module (`validate-env.ts`) because it provides one source of truth for reading and validating environment variables. It reduces configuration duplication and supports fail-fast validation during startup. Environment-specific values can be injected without maintaining separate configuration files in git or rebuilding Docker images.
