# Module 03 – Step 1: CONTEXT – Design Documents & RFCs Reflection

## 1. Mid-Build Course Corrections & Early Validation
- **Common Failure Mode:** Commencing implementation before validating data models, cross-service contracts, or infrastructure constraints leads to expensive rework when query patterns or communication boundaries fail.
- **Pre-Emptive Diagnostics:** Circulating an architectural sketch and asking targeted questions early:
  - *Does this schema support required access patterns and lifecycle queries?*
  - *How do services communicate, and does existing network/proxy infrastructure support this transport?*
  - *What downstream dependencies or licensing constraints exist?*

## 2. The Minimum Viable Design Document (RFC)
A 1-page proposal that elicits high-signal feedback before building must contain seven core pillars:
1. **Problem Statement:** Explicitly defining the customer or system problem and why solving it matters now.
2. **Goals & Non-Goals:** Setting strict functional boundaries to prevent scope creep.
3. **Proposed Solution:** High-level architectural topology, component interactions, and data flow.
4. **Alternatives Considered:** Documenting competing approaches and the technical rationale for why they were rejected.
5. **Data & API Contracts:** Target database schemas, enum definitions, and interface specifications.
6. **Risks & Infrastructure Dependencies:** Highlighting scalability bottlenecks, security boundaries, and infrastructure assumptions (e.g. proxy support).
7. **Open Questions:** Explicitly surfacing contested trade-offs and decisions requiring cross-functional consensus.
