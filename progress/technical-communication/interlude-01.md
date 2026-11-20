# Interlude 01 – The Mars Climate Orbiter ($327M Unit Mismatch)

## 1. Implicit Assumptions in Engineering Specifications
- **Vulnerability:** Assuming field names, lifecycle status values, date formats, and error semantics are self-explanatory across system boundaries.
- **Concrete Example:** A timestamp field bare-named `created_at` or `scheduled_time` can be misread as UTC by one service and local server time by another; an enum like `ACTIVE` or `PENDING` often carries diverging operational connotations across microservices.
- **Remediation:** Technical specifications must explicitly document conventions, units, and boundaries rather than relying on assumed consensus.

## 2. Interface Verification & Contract Drift
- **Boundary Risk:** Two competent teams building independent services often assume symmetric interpretations of shared contracts.
- **Prevention Strategy:** Interface validation must go beyond passive spec sharing. Teams must conduct joint schema verification, establish centralized enum contracts, and execute bilateral contract tests validating real example payloads against agreed schemas before integration.

## 3. High-Stakes Precision ("The Four Missing Words")
- **Triage Principle:** Clarification depth is proportional to the blast radius of ambiguity. Interfaces governing financial transactions, authorization, data consistency, and cross-service contracts demand exhaustive, pedantic precision.
- **Example in System Design:** In URL shortener and redirect architectures, explicitly stating that `expires_at` is an *"ISO-8601 UTC timestamp"* and defining that *"expired links must return HTTP 410 Gone"* prevents drift between database backends and cache validation layers.
