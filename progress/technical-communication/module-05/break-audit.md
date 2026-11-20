# Module 05 — BREAK: Stakeholder Communication Audit

## 1. Part 1: Count the Jargon

A line-by-line audit identified **41 distinct technical terms and acronyms** that a non-technical product manager or executive stakeholder (such as David, Head of Product) would not understand without explanation:

| Category | Technical Terms & Phrases Identified |
| :--- | :--- |
| **Gateway & Proxy Technologies** | API gateway, Kong, NGINX, reverse proxy, Envoy, ingress |
| **Protocols & Security** | mTLS, JWT, zero-trust, east-west traffic |
| **Server Infrastructure** | Autoscaling group, gateway nodes, c5.2xlarge instances, Kubernetes, pod, node pool |
| **Performance Metrics** | RPS, p95, p99, throughput, SLO, availability |
| **Service Mesh Mechanics** | Istio sidecars, circuit breaking, retry budgets |
| **Development & Deployment** | Lua plugins, WASM filters, CI/CD, GitOps, blue-green deployment, cutover |
| **Monitoring & Telemetry** | StatsD, Grafana, OpenTelemetry collectors, Datadog |
| **Testing & Capacity** | Synthetic load tests, staging, reserved capacity, production traffic |

### Why This Is a Communication Failure
David cares about customer checkout conversion, platform uptime, and feature release velocity. Marcus explains *how* the underlying machinery functions rather than *why* the business should care. For example, stating that *"p99 spiked to 1.8 seconds cascading into checkout timeouts"* fails to convey the financial reality: customers experienced agonizing delays during Black Friday, carts were abandoned, and transactions failed at peak revenue hours.

---

## 2. Part 2: The Buried Business Risk

Behind the technical description of *"Istio sidecar injection increasing pod memory overhead by 128MB per pod... 42.5 GB additional cluster memory... unvalidated against reserved capacity for autoscaling"* lies a catastrophic operational and financial hazard:

> **Plain-Language Translation for David:**  
> *"If our servers run out of available memory during a holiday traffic surge, our checkout system will fail to scale up, causing customer purchases to stall or crash at the exact moment of peak annual revenue."*

This risk completely contradicts Marcus's earlier claim that the migration involves *"no customer-facing downtime."* If cluster memory headroom is exhausted during autoscaling events, pods will crash-loop under memory pressure (OOMKilled), creating an outage far worse than the one the migration is intended to solve.

---

## 3. Part 3: Where Is the Ask?

Marcus concludes his email with *"Let me know if you have questions"*—a passive dismissal that requests no action, forces no prioritization, and secures no accountability.

### Required Actionable Asks:

1. **Engineering Resource & Capacity Allocation (VP of Engineering):**  
   Formally request approval to dedicate 2 platform engineers full-time for 8 weeks in Q3, explicitly agreeing on which lower-priority technical debt or infrastructure tasks will be deprioritized.
2. **Product Roadmap Alignment & Velocity Tradeoff (Head of Product):**  
   Request David's review and sign-off on the roadmap impact: confirm that allocating 16 engineer-weeks to this migration will not block high-priority Q3 customer-facing product milestones.
3. **Infrastructure Budget & Capacity Pre-Validation (Engineering & Finance):**  
   Request authorization to benchmark cluster memory utilization under simulated Black Friday load and approve provisioning additional cluster nodes/budget if reserved autoscaling headroom is insufficient.
4. **Gated Production Cutover Criteria (Joint Leadership):**  
   Establish an explicit sign-off gate requiring successful completion of staging load tests at 24K RPS and automated rollback rehearsals before authorizing live production cutover.

---

## 4. Final Assessment

Marcus's email is an exemplar of technical expertise trapped behind an impenetrable wall of engineering jargon. It misidentifies its audience, buries an existential capacity risk under memory arithmetic, and neglects to ask for decisions. Effective stakeholder communication must clearly answer three foundational questions for leadership: **What changes for our business? What could go wrong? What decision do you need from me today?**
