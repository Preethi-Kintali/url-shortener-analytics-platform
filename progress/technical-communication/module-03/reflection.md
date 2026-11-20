# Module 03 – Final Reflection: Design Documents & RFCs

## 1. RFC Format in Practice
- **Reaffirming Lightweight Default:** The lightweight RFC format successfully balances engineering velocity with early cross-team scrutiny. Drafting the core pillars (Problem, Solution, Alternatives, Risks, Open Questions) surfaces foundational architectural disagreements within an hour, before developers invest weeks writing code or develop emotional confirmation bias.
- **Progressive Depth:** As project complexity increases (e.g. data migrations or multi-datacenter replication), the lightweight RFC acts as the initial alignment gate that seamlessly expands into detailed schema and implementation specs.

## 2. Design Documents as Cross-Functional Trust Engines
- **Inclusive Architecture:** Circulating proposals before building invites infrastructure, security, and SRE teams to identify platform constraints (such as proxy statefulness or authentication risks) proactively.
- **Shared Ownership:** Pre-build RFCs transform technical decisions from isolated choices into collaborative agreements. Late-stage announcements after coding alienate partner teams and lead to expensive rework.

## 3. Heuristic Rule of Thumb
- **RFC Mandatory:** Changes impacting multiple services, shared database schemas, distributed state synchronization, security/auth boundaries, or infrastructure budgets where rolling back an error exceeds one week of engineering effort.
- **Technical Note Sufficient:** Adding a scoped endpoint or non-breaking internal service refactor.
- **RFC Overkill:** Isolated bug fixes, configuration tweaks, or minor UI adjustments.
- **Core Principle:** Documentation exists to reduce operational risk and technical uncertainty, not to create bureaucratic friction.
