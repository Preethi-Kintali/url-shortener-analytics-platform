# Module 05 CONTEXT: Incident Response Protocol & Severity Classification

## 1. Principles of Incident Triage
Incident response is debugging under active production pressure, strict time constraints, and multi-stakeholder scrutiny.
- **The Core Rule**: Triage first, then mitigate, then investigate, then permanently fix.
- **The Friday 4 PM Anti-Pattern**: Pushing unverified fixes under panic turns minor incidents (SEV3 campfires) into catastrophic global outages (SEV1 house fires). Disciplined triage prevents panic-driven regression.

---

## 2. Severity Classification Matrix & Micro-Exercise

| Scenario | Severity | Rationale & Response Playbook |
| :--- | :---: | :--- |
| **1. Homepage loads, but product images are broken (alt-text visible)** | **SEV2** | **High Impact on Customer Experience & Revenue**: While the application remains available, product discovery and customer purchase decisions are severely degraded. Requires dedicated on-call responders and regular stakeholder updates, without paging the entire engineering department. |
| **2. Cross-user IDOR allowing access to other users' private data via URL parameters** | **SEV1** | **Critical Security Breach & Active Data Exposure**: Unauthorized access to private customer data violates confidentiality and carries regulatory, legal, and reputational ramifications. Mandates immediate all-hands mobilization, executive escalation, and rapid access containment. |
| **3. Background analytics job generating weekly reports is delayed by 2 hours** | **SEV3** | **Minor / Non-Critical Operational Delay**: Real-time user interactions and core application APIs operate normally. Reports are delayed, not corrupted or permanently lost. Handled during normal business hours with standard monitoring. |

---

## 3. The Incident Response Hierarchy

```
+--------------------------------------------------------------------------+
|                       INCIDENT RESPONSE TRIAGE PYRAMID                   |
+--------------------------------------------------------------------------+
|  [SEV1] CRITICAL OUTAGE / BREACH  -> All-hands page; 15-min exec updates |
|  [SEV2] MAJOR FEATURE DEGRADED   -> Dedicated responder; 30-min updates  |
|  [SEV3] MINOR / BACKGROUND DELAY -> Business-hour ticket; no paging      |
+--------------------------------------------------------------------------+
```
