# Module 06: Documentation That Gets Read — DECIDE

## Decision: Option A — Comprehensive Documentation in the Repository (`comprehensive`)

### Strategic Rationale
Documentation should live as close to code as possible, version-controlled in the same PRs, ensuring high reliability during 3 AM incidents without external tool dependencies, and treated as verified code.

### Key Factors Considered
1. **Reliability During Production Incidents:** During outages, engineers need immediate access to verified troubleshooting steps and recovery runbooks. Keeping authoritative documentation inside the repository ensures that it is always available alongside the code without depending on external SaaS wikis or permission silos.
2. **Atomic Code & Documentation Evolution:** Modifying an API contract, database schema, or configuration requires updating the documentation in the exact same commit and pull request, making doc maintenance an integral engineering gate rather than an easily neglected afterthought.
3. **Long-Term Preservation & History:** Version control provides complete git blame history, peer code review, and rollback capabilities that external tools lack.
4. **Preventing Documentation Rot:** Treats documentation as code through CI validation, mandatory PR review gates, assigned document ownership, and scheduled verification against real production setups.
