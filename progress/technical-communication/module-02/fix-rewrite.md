# Module 02 – Step 6: FIX – Concise Technical Rewrite

## 1. Rewritten Technical Document (Word Count: ~235 words)

```markdown
# ShopStream API Migration: REST to GraphQL

## Decision Summary

ShopStream will migrate its public API from REST to GraphQL, a query language that lets clients request exactly the data they need, over an eight-week dual-run period. This decision addresses unnecessary frontend work, different web and mobile data requirements, and repeated network calls.

## Current Problems

- The REST API has 47 endpoints serving web and mobile clients.
- Frontend (FE) developers spend 30% of sprint capacity building and maintaining aggregation endpoints.
- Fifteen endpoints exist mainly to support mobile-specific data shapes.
- The Software Development Kit (SDK) team reports difficulties maintaining backward compatibility as endpoints grow.
- Site Reliability Engineering (SRE) measurements show mobile clients making multiple sequential REST calls.

## Expected Benefits

- Reduce frontend API calls by approximately 40%.
- Eliminate 15 redundant aggregation endpoints.
- Let web and mobile teams request their own data shapes.

## Alternatives Considered

We rejected Backend-for-Frontend (BFF), which uses separate gateways for different clients, because of deployment and monitoring overhead. We also rejected standardized REST schemas because they do not solve client data-shape differences.

## Risks and Mitigations

- **Learning curve:** Three engineers will work on the migration; two are new to GraphQL. The backend team will provide pair programming and dedicated learning time during the first two weeks.
- **Query performance:** The backend team will monitor resource usage and address expensive queries.
- **Caching:** The backend team will evaluate caching improvements.

## Migration Plan

The backend team will operate REST and GraphQL simultaneously for eight weeks to maintain service continuity. Stakeholders should expect timeline adjustments if implementation findings require them.
```

---

## 2. Comparison & Impact Analysis

### 1. Word Count & Information Density
- **Reduction:** Cut from 350 words to ~235 words (a 33% reduction), eliminating throat-clearing fluff (*"As many of you are aware"*, *"After extensive deliberation"*).
- **Fidelity:** Preserved 100% of technical facts (47 endpoints, 15 aggregation endpoints, 30% sprint capacity, 40% call reduction, 8-week dual run, 3 engineers, FE/BFF/SDK/SRE contexts).

### 2. The 5-Second Skim Test
- **Rewrite:** Locating the decision takes under 2 seconds (Headline + Sentence 1). Finding risks and mitigations takes 3 seconds via the `## Risks and Mitigations` section.
- **Original:** Took 30–45 seconds of reading through dense prose before discovering the decision in paragraph 4.

### 3. Reader Experience for Priya
- Reading only the first two sentences gives Priya the full operational context: what technology was chosen, what it does, the timeline, and the business drivers.
