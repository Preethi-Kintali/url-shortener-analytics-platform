# Module 01 – Step 7: REFLECT
## Requirements Extraction & Contradiction Resolution Retrospective

### 1. Requirements Breakdown & Ratio
- **Total Requirements Identified:** 20
- **Explicit vs. Implicit Ratio:** 13 Explicit (65%) to 7 Implicit/Silence-Pass (35%).
- **Reflection:** Over a third of critical system requirements came from what was left unsaid. In real-world projects, stakeholders describe high-level goals but often omit edge cases, data consistency constraints, security boundaries, performance SLAs, and failure scenarios. Requirements engineering is as much about detecting systemic omissions as it is about cataloging written text.

### 2. Spotting the Contradiction
- **The Finding:** A direct conflict existed between original provider cancellation autonomy (Paragraph 2) and the operations update mandating a blanket 24-hour full refund policy (Paragraph 1).
- **Reflection:** Contradictions routinely slip past initial reviews because specifications are written and updated incrementally by different teams at different times without systematic cross-referencing. Without comparing downstream rules across stakeholder boundaries, an engineering team would have built mutually conflicting business logic that could result in double refunds or provider calendar theft.

### 3. Handling Ambiguity & Proposing Solutions
- **The Finding:** Rather than bouncing the problem back to the PM with a passive "needs clarification" note, we formulated two concrete options:
  - *Option 1:* Platform-First Universal Cancellation Policy (demand consistency, simple architecture, zero provider autonomy).
  - *Option 2:* Provider Tiered Policy with Platform Cooling-Off Floor (balanced autonomy, 2-hour safety net, moderate architecture).
- **Reflection:** Senior engineers don't just point at problems; they engineer viable choices. By framing the choices with trade-offs, stakeholder impacts, and implementation complexity, the product team can make informed strategic decisions immediately without technical ambiguity.

### 4. Decision Callback – Categorized Matrix vs Flat List
- **The Choice:** Option B (Categorized Matrix: Stakeholder × Type Grid).
- **Reflection:** Forcing requirements into functional, constraint, and quality attribute buckets across Learner, Provider, and Platform stakeholders surfaced cross-cutting implications. For instance, the 15% marketplace commission is not merely a payment detail—it is an immutable financial constraint affecting provider earnings visibility, ledger reconciliation, dispute clawbacks, and gateway fee absorption. A flat list would have obscured these multi-stakeholder dependencies.

### 5. Core Takeaway
- Engineering begins before architecture or code. Thorough three-pass requirement extraction (Verb, Qualifier, Silence), rigorous cross-referencing, and proactive problem formulation prevent expensive architectural rework and production bugs.
