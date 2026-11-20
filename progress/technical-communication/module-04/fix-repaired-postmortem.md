# Incident Postmortem: Silent Checkout Ingestion Failure and Dropped Orders

**Incident Reference:** INC-ORD-0315  
**Service Affected:** OrderProcessor (Order Ingestion & Checkout Flow)  
**Date of Incident:** Wednesday, March 15 *(Note: Weekday/calendar alignment corresponds to 2023 or March 18 in 2026; year is unverified in source scenario telemetry)*  
**Incident Severity:** Sev-1 (Critical Business Impact)  
**Duration:** 2 hours 2 minutes (14:00 UTC – 16:02 UTC)  

---

## 1. Summary

On Wednesday, March 15, between 14:00 UTC and 16:02 UTC, a configuration discrepancy in OrderProcessor v2.14 caused the service to silently drop approximately 1,400 customer orders totaling $186,000 in gross merchandise value. During the checkout flow, customer credit card charges were successfully authorized and captured by the payment gateway, and customers were presented with a standard order confirmation page. However, the service failed to persist the order records in the database. The failure was completely masked from automated monitors because the application caught database persistence exceptions in a broad error handler, logged them at `DEBUG` level (which was suppressed in production), and returned HTTP 200 OK responses to clients. Standard platform monitoring evaluated only HTTP response codes and system resource utilization rather than transactional database write throughput. The incident was mitigated at 15:34 UTC via a manual rollback to v2.13 by Platform Engineering after automated rollback scripts failed due to obsolete deployment artifact paths. All 1,400 dropped transactions were reconstructed from payment gateway audit logs and reprocessed by 16:02 UTC with confirmation receipts dispatched, resulting in zero permanent data loss or customer overbilling.

---

## 2. Chronological Timeline of Events

*All timestamps in UTC.*

- **14:00** — OrderProcessor v2.14 deployment completed to production. The release removed the `warehouse_routing` configuration key following an established 6-month deprecation lifecycle.
- **14:00–14:22** — Automated synthetic monitors and APM dashboards reported green; HTTP response codes remained 100% 200 OK with normal p95 latency (< 50ms) and healthy host resource utilization.
- **14:22** — Initial customer feedback surfaced on social media and customer support queues reporting missing confirmation emails after successful payment capture.
- **14:23** — Customer Support escalated the issue in the `#cs-escalations` Slack channel.
- **14:25** — The escalation was initially classified as a downstream email delivery provider delay due to similar third-party vendor latency experienced in recent weeks; no live database diagnostics were executed.
- **14:38** — A sustained influx of support tickets regarding missing orders triggered technical investigation by the On-Call Responder.
- **14:42** — Health dashboards and API response codes continued showing 100% 200 OK with normal latency.
- **14:55** — Direct database inspection by the On-Call Responder revealed that zero order records had been written since 14:00 UTC, confirming a complete silent order ingestion failure.
- **15:02** — The v2.14 deployment was isolated as the catalyst, and an automated rollback to v2.13 was initiated.
- **15:08** — Automated rollback failed due to outdated artifact repository paths in deployment manifests left unexercised following the cloud infrastructure migration 4 months prior.
- **15:15** — Secondary escalation to Platform Engineering to execute an emergency out-of-band manual container rollback.
- **15:34** — Platform Engineering completed manual rollback to v2.13; live order persistence resumed immediately and was verified against database write counters.
- **15:45** — Checkout Engineering and Data Engineering initiated transaction reconciliation scripts to extract captured charges from payment processor gateway audit logs.
- **16:02** — All 1,400 dropped transactions were reprocessed, order records created, and confirmation emails dispatched. Incident resolved.

---

## 3. Root Causes

1. **Decoupled Payment Capture and Silent Exception Swallowing:**  
   The checkout architecture lacked transactional consistency between the payment gateway and the persistence layer. The service captured payment funds synchronously prior to verifying database persistence, without an automated compensating transaction (void or refund) if database insertion failed. When the application attempted to read the removed `warehouse_routing` field, a `KeyError` was raised. Rather than propagating the failure or initiating payment reversal, the ingestion handler caught the exception, logged it at `DEBUG` level (which was filtered out in production), and returned an HTTP 200 OK with a confirmation payload.

2. **Configuration Drift and Missing Static Schema Contracts:**  
   The staging environment configuration schema had drifted months prior to an alternate schema that omitted `warehouse_routing`. Consequently, automated pre-deployment integration and smoke tests in staging passed without exercising the code branch dependent on the missing configuration. The CI/CD pipeline lacked static schema validation to verify that all configuration keys referenced by application source code existed in target environment configurations prior to deployment.

---

## 4. Contributing Factors

1. **Transport-Only Observability Without Business Domain Invariants:**  
   Platform monitoring tracked only low-level transport metrics (HTTP status codes, ingress latency, CPU, and memory). In the absence of domain-level alerts for order persistence rates, a 100% transaction failure was reported as healthy.

2. **Missing Business-Impact Verification During Escalation:**  
   The escalation procedure lacked a structured diagnostic gate. When initial customer complaints surfaced, triage followed assumptions based on past third-party email vendor incidents rather than executing a mandatory data-integrity verification query against live database write telemetry.

3. **Rollback Automation Decay:**  
   Disaster recovery automation had not been exercised or tested since the cloud infrastructure migration 4 months prior, converting what should have been a 2-minute automated recovery into a 26-minute manual mitigation.

---

## 5. Preventative Action Items

| Item ID | Description | Role Owner | Target Deadline | Definition of Done |
| :--- | :--- | :--- | :--- | :--- |
| **ACT-01** | Refactor checkout transaction boundary: implement two-phase payment safety where funds are authorized first, order persistence is committed in the database, and capture is finalized only upon success. If persistence fails, log the exception at `ERROR` level with stack trace, immediately void the authorization (or issue an automated refund if capture completed), and return an explicit HTTP 500 error code. | Checkout Service Tech Lead | 3 business days | Unit and integration test suite merged proving that injected persistence failures trigger payment voiding/refund, emit structured `ERROR` alerts, and return HTTP 500. |
| **ACT-02** | Implement business-invariant canary alerting in Datadog/CloudWatch: calculate dynamic baseline using 5-minute rolling average compared against the 3-week historical median for the identical day-of-week and time-of-day. Trigger high-urgency PagerDuty alert if order creation drops >50% below baseline or hits 0 orders for >2 consecutive minutes during peak hours (08:00–22:00 UTC). | Site Reliability Engineering (SRE) Lead | 5 business days | Synthetic traffic cut in staging verifies that order drops trigger high-urgency PagerDuty incident within 120 seconds. |
| **ACT-03** | Implement automated configuration contract validation in CI/CD: build a pre-deployment linter that cross-references all configuration lookups in source code against target deployment manifests; enforce automated daily schema parity checks between staging and production. | Platform Engineering Lead | 2 weeks | Automated CI gate blocks PRs that remove referenced config keys; daily schema parity checker active across staging and production. |
| **ACT-04** | Remediate rollback manifests to current artifact repository paths and establish bi-weekly automated chaos rollback verification tests in staging CI/CD pipelines. | Release Engineering Lead | 1 week | Automated pipeline executes a deployment and immediate automated rollback in staging, succeeding without human intervention in < 180 seconds. |
| **ACT-05** | Deploy `/escalate-order-issue` Slack workflow enforcing a 5-minute Sev-1 SLA: the 5-minute timer starts immediately upon workflow submission; acknowledgement requires the on-call engineer to click 'Acknowledge' in PagerDuty or enter `/ack` in the incident channel (transitioning state from Triggered to Investigating; fails over to secondary on-call if unacknowledged at 5:00); workflow embeds a live 15-minute database order insertion rate chart and requires explicit data-layer query verification prior to ticket downgrade or closure. | Technical Support Operations Lead | 1 week | Workflow deployed; simulated escalation drill conducted with support and on-call rotations verifying timer start, automated PagerDuty page, acknowledgement within 5 minutes, and mandatory database metric verification. |

---

## 6. Lessons Learned

- **Systemic Consistency Over Local Handling:** Transactional boundaries must link financial commitments to data persistence. Error handling must propagate unexpected failures and trigger automated compensatory workflows rather than returning false success payloads to callers.
- **Business Domain Observability:** Operational dashboards must measure primary business outcomes (e.g. orders written to persistent storage per minute) in addition to network-level HTTP response codes and infrastructure health.
- **Continuous Validation of Emergency Runbooks:** Disaster recovery automation degrades rapidly if not tested continuously in CI/CD. Rollback pipelines must be exercised as regularly as deployment pipelines.
