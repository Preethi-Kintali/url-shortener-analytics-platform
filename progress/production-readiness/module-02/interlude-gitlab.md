# Interlude: GitLab Deletes Their Production Database

## Incident Reflection & Architectural Takeaways

### 1. Monitoring vs. Verification
> Monitoring that a backup job runs only confirms that the process was triggered. It does not guarantee that valid backup data was created. We should verify backup success by checking the output, validating its integrity, and regularly performing automated test restores to ensure the data can actually be recovered.

### 2. Convention vs. Infrastructure Safeguards
> Production safety should not depend only on human discipline. We should enforce infrastructure-level protections such as separate environments, restricted production permissions, explicit confirmation for destructive commands, approval workflows, and automated safeguards. This reduces the possibility of accidental production data deletion even when an engineer makes a mistake.

## Key SRE Principles
- **Schrödinger's Backup:** The condition of any backup is unknown until you restore from it. True backup reliability requires continuous, automated restore testing into an isolated staging environment.
- **Blast Radius & Least Privilege:** Destructive commands (`rm -rf`, `DROP TABLE`, `FLUSHDB`) must never be executable via interactive shell sessions on production primaries without break-glass multi-party authorization and explicit guardrails.
- **Strict Environment Isolation:** Environment boundaries must be reinforced by network isolation, distinct credentials, visual shell cues, and immutable infrastructure.
