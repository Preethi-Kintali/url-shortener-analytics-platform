# Module 07: Runbooks & Operational Docs - Verification Report

## 1. Artifact Verification Matrix

| Verification Check | Required Criterion | Observed Artifact State | Status |
|---|---|---|---|
| **Service Overview** | 2-sentence purpose, dependency matrix with M06 fallbacks, endpoints, config runtime rules, exact deploy/rollback commands, ownership | `docs/service-overview.md` covers all 7 mandatory sections with copy-pasteable commands | **VERIFIED** |
| **Top 3 Runbooks** | 1. Database Connection Failure<br>2. Redis Partition<br>3. Latency & Breaker Flapping | `docs/runbooks.md` provides complete runbooks with exact alert names (`HighErrorRate`, `HighLatency`, `DatabaseDown`) | **VERIFIED** |
| **Expected Outputs** | Every diagnostic command must specify expected output for BOTH positive (problem) and negative (healthy) states | Both states explicitly defined across all 3 runbooks (e.g. `Exited` vs `Up`) | **VERIFIED** |
| **Zero Decision Placeholders** | No `<container-name>`, `<id>`, or \"restart the service\" phrases | All commands contain literal container names (`upsk-sdf-postgres`, `bootcamp-redis`, `myservice-prod`) | **VERIFIED** |
| **Empirical Drill** | At least one runbook tested during simulated failure | Runbook 1 tested via `test-runbook-drill.js`: 0 discrepancies found | **VERIFIED** |

---

## 2. Tech Lead Conceptual Verification

### 1. Lifecycle of a Runbook & Drift Detection
- **Trigger Events for Runbook Updates:**
  - **Post-Incident Analysis:** Immediate update following any incident where the runbook was exercised, capturing unforeseen edge cases or missing telemetry commands.
  - **Infrastructure & Architectural Changes:** Any PR modifying dependencies, container configurations, environment variables, or CLI tooling must update the runbook in the same commit.
  - **Scheduled Review Cadence:** Quarterly review cycles by team members not involved in the original authoring.
- **Proactive Drift Detection:**
  - **Automated Verification:** CI jobs or integration smoke tests that execute runbook diagnostic commands against test environments to ensure flags and outputs remain valid.
  - **Chaos Game Days & Drills:** Scheduled fire drills where an on-call engineer simulates an outage and must recover the service strictly following the written runbook without external guidance.

### 2. Runbook vs. Architecture Wiki
| Dimension | Architecture Wiki / README | Incident Runbook |
|---|---|---|
| **Primary Goal** | Build conceptual understanding and document system design | Drive rapid, safe, and unambiguous recovery under time pressure |
| **Reading Context** | Calm, daytime development, architecture reviews, onboarding | 3 AM crisis, sleep deprivation, active revenue loss, adrenaline |
| **Tone & Structure** | Descriptive: *"Here is how Redis caching interacts with the PostgreSQL write path"* | Prescriptive: *"Run command X. If output contains Y, run command Z"* |
| **Cognitive Load** | High: Requires synthesis, reasoning, and domain context | Low: Minimal decision points, linear checks, literal copy-paste commands |
| **Analogy** | Textbook on aeronautical engineering | Emergency checklist in the cockpit during engine failure |
