# Subject: Q3 Platform Proposal: Upgrading Gateway Infrastructure to Protect Holiday Checkout Capacity

**To:** Sarah (VP of Engineering), David (Head of Product)  
**From:** Marcus (Platform Engineering Lead)  
**Date:** Q3 Planning Cycle  

---

### 1. Executive Summary
We propose upgrading our central traffic routing infrastructure during Q3 to prevent a recurrence of the checkout slowdowns experienced during last year’s holiday shopping peak. This 8-week initiative requires dedicating two platform engineers to replace our aging gateway software with a modern system designed to sustain more than double our peak traffic. To protect service stability, we will run the new system in parallel with the current setup during testing and will cut over only after meeting strict performance and capacity thresholds.

### 2. The Problem: Last November's Black Friday Bottleneck
During Black Friday last November, customer traffic reached 11,400 requests per second (RPS), exposing hard limits in our gateway infrastructure:
- **Customer Impact:** 99th-percentile (p99) response times spiked to 1.8 seconds, cascading into timeout errors on the checkout service.
- **Service Degradation:** Checkout availability dropped to 99.2% for approximately 47 minutes, breaching our agreed 99.95% availability target (SLO).
- **The Core Capacity Limit:** Our current routing software (an end-of-life version of Kong behind NGINX) operates with a fixed ceiling of approximately 12,000 RPS. Having reached 11,400 RPS last year, the system has virtually no headroom left to absorb anticipated holiday business growth.

### 3. Proposed Migration & Engineering Effort
We propose migrating from our current Kong and NGINX setup to an Envoy-based routing layer integrated with our existing Kubernetes cluster.
- **Scope & Effort:** 2 platform engineers for 8 weeks in Q3. The work primarily consists of rewriting 14 custom routing plugins (Lua) as modern filters (WASM), updating deployment pipelines to use GitOps, and transitioning monitoring collectors to OpenTelemetry feeding into our existing Datadog tenant.
- **Deployment Strategy:** We will deploy the new system in parallel alongside the existing setup (blue-green deployment) to minimize risk before traffic cutover.

### 4. Key Risks and Mitigation Strategy
- **Buried Cluster Memory Risk (Action Required):** The new routing architecture introduces approximately 128 MB of memory overhead per pod, totaling an additional 42.5 GB across our 340 pods. If this extra demand exhausts cluster memory during a holiday surge, our services will be unable to autoscale, triggering the same checkout timeouts seen last year. We must validate cluster capacity against reserved autoscaling requirements in staging to determine whether additional infrastructure budget is needed before cutover.
- **Performance Thresholds & Fallback Plan:** We will run synthetic load tests in staging at 2x production traffic (24,000 RPS). If the new system cannot sustain 24,000 RPS at p95 latency under 150 ms, we will abort the cutover and fall back to the existing Kong setup.

### 5. Decisions Needed From Leadership
To proceed with this Q3 initiative, we request the following decisions:

1. **Engineering Allocation (Sarah):** Approval to allocate 2 platform engineers full-time for the 8-week Q3 project duration.
2. **Product Roadmap Alignment (David):** Review and confirmation of any feature-delivery tradeoffs resulting from dedicating these two engineers to infrastructure during Q3.
3. **Capacity Validation & Cutover Criteria (Sarah & David):** Agreement on the pre-cutover testing gate (validating cluster memory headroom and achieving 24,000 RPS at p95 < 150 ms in staging), including approval to assess whether additional infrastructure budget will be required for cluster capacity.
