# Module 07: Runbooks & Operational Docs - Reflection

## 1. Format Retrospective: The Hybrid Advantage
- **Retained Decision:** **Hybrid Architecture (Linear Checklist Foundation + Decision Tree Routing)**.
- **Operational Justification:**
  - The linear checklist establishes a disciplined, safe baseline (validating alert severity, container state, log signatures, resource usage, and probe status) before any state-altering action is taken.
  - The decision-routing branches then guide the operator directly into targeted, symptom-specific remediation trees (PostgreSQL pool exhaustion, Redis degradation, latency/circuit breaker flapping) without wasting time guessing.
  - Empirical testing proved this approach's value: running the checklist under simulated failure immediately exposed cold-start socket stabilization delays and container name drift, which were corrected before documentation entered production.

---

## 2. Used vs. Ignored Runbooks: The Trust Equation
- **Why Runbooks Get Ignored:**
  - Outdated or broken commands that throw errors upon execution.
  - Vague instructions like *"restart the service"* or *"check the logs"* without specific flags, log locations, or filters.
  - Unclear or missing expected outputs, leaving the operator uncertain whether a command revealed an issue or verified normal health.
  - Conflating architecture reference wikis with emergency cockpit checklists.
- **Why Runbooks Build Trust at 3 AM:**
  - 100% copy-pasteable commands with zero `<placeholders>`.
  - Dual-state expected outputs (explicitly showing what the output looks like when BROKEN vs when HEALTHY).
  - Explicit non-destructive steps and clear escalation boundaries.

---

## 3. Onboarding a Teammate from Documentation Alone
1. **System Literacy:** Start with [docs/service-overview.md](../../../docs/service-overview.md) to understand business purpose, upstream/downstream dependency topography, environment variable runtime rules, deploy/rollback mechanics, and escalation SLAs.
2. **Operational Competency:** Review [docs/runbooks.md](../../../docs/runbooks.md) to study the primary failure modes, telemetry signatures, and diagnosis workflows.
3. **Safe Sandbox Drills:** In a staging or local environment, have the new engineer intentionally stop PostgreSQL and Redis, follow the runbook commands verbatim, observe the exact output strings, and restore the service.
4. **Shadowing:** Pair on on-call rotations to observe real incident triage before assuming primary pager ownership.

---

## 4. Runbook Maintenance & Preventing Operational Rot
Runbooks must be treated as living production code, governed by the same CI/CD and review rigor:
- **CI Smoke Tests:** Automated CI jobs that parse and execute runbook diagnostic commands and health probes against hermetic test containers.
- **PR Checklists:** Mandatory pull-request checklist items requiring documentation updates whenever environment variables, container names, ports, or dependencies change.
- **Scheduled Game Days / Chaos Drills:** Monthly fire drills where an engineer simulates an outage and recovers the platform strictly following the written runbook without team help.
- **Post-Incident Action Items:** Every incident postmortem must audit the runbook used during the incident, fixing ambiguities and updating commands within 48 hours.
