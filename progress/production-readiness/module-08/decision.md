# Module 08: Deploy & Verify - Decisions

## Decision 1: Deployment Strategy
- **Choice:** **Option A — Rolling Deployment (`rolling`)**
- **Rationale:**
  - Blue-green deployments require a persistent $2\times$ infrastructure resource allocation, which is unnecessary and cost-prohibitive for our stateless containerized service footprint.
  - Rolling deployments gradually replace older containers one instance at a time, routing traffic only after passing deep `/ready` probe gates.
  - **Schema Compatibility Guardrail:** Mixed-version coexistence is safely managed via expand/contract database migrations (`prisma migrate deploy`), ensuring backwards and forwards schema compatibility across adjacent releases.
  - **Version Attestation:** Every running container is verified against the targeted immutable Git commit SHA.

---

## Decision 2: Rollback Approach
- **Choice:** **Option A — Automated Rollback (`automated`)**
- **Rationale:**
  - A faulty release actively impacting end users must not wait for 3 AM human pager acknowledgement, log triage, and manual rollback commands.
  - The deployment orchestrator continuously monitors `/ready` responses and route-level error rates across a 60-second evaluation window. If 3 consecutive probe failures or an error spike exceeds 5%, traffic is instantly reverted to the previous commit SHA image (`myservice:$PREV_SHA`).
  - **Blip Prevention:** Root cause attribution distinguishes between dependency partitions (which trigger circuit breakers) and application release failures (which trigger rollbacks), preventing false-positive rollback loops.
  - Manual override commands from [docs/runbooks.md](../../../docs/runbooks.md) remain fully accessible as an operational fallback.
