# Technical Explanation: REST-to-GraphQL Migration

## Decision Summary

ShopStream will migrate its public API from REST to GraphQL over eight weeks while keeping both APIs operational. This migration aims to reduce frontend network calls by 40%, remove 15 redundant aggregation endpoints, and allow web and mobile teams to request the data they need independently.

## Why We Chose This

ShopStream currently uses 47 REST endpoints. REST is an API approach where each endpoint provides a predefined response, similar to ordering a fixed combo meal. This works well for simple requests, but our web and mobile applications often need different data shapes.

As a result, 15 endpoints exist mainly to support mobile-specific responses. Frontend developers also spend approximately 30% of sprint capacity creating temporary aggregation endpoints to combine data from multiple backend services.

GraphQL provides a more flexible approach. Think of it as ordering à la carte: the client requests exactly the fields it needs through a single query. This reduces unnecessary data transfers and avoids creating separate backend endpoints for every UI requirement.

We considered two alternatives. We rejected Backend-for-Frontend (BFF), which creates separate API gateways for different clients, because it would increase deployment and monitoring overhead. We also rejected standardized REST schemas because they would not solve the fundamental differences between web and mobile data requirements.

## Risks and Mitigations

- **Learning curve:** Three engineers will work full-time on the migration, and two are new to GraphQL. The experienced engineers will conduct knowledge-sharing sessions and pair with them.
- **Unpredictable queries:** Deeply nested GraphQL queries can consume excessive server resources. The backend team will implement query depth limits and appropriate resource controls.
- **Caching complexity:** GraphQL commonly sends queries through HTTP POST requests, which are not cached like ordinary GET URLs by default. The team will evaluate response caching and persisted queries to improve performance.

We will run REST and GraphQL together for eight weeks, allowing teams to validate the new API before gradually moving clients to it.

## What This Means for Priya

Priya will join the backend team and contribute to the GraphQL migration. She will first understand the existing REST endpoints, identify how the web and mobile clients use them, and learn how the new GraphQL schema maps to existing backend data.

She will work with an experienced GraphQL engineer to implement and test a small query before taking on larger migration tasks.

## Next Steps

1. Priya will review the existing API documentation and GraphQL migration design.
2. Priya will pair with one of the experienced GraphQL engineers during her first week.
3. The backend team will assign her a small query implementation and related tests.
4. Priya will validate the query against both web and mobile requirements.
5. She will use the team's backend documentation repository, specifically its GraphQL migration and API design sections, as her primary reference.

The team lead will share the repository location and onboarding task before Priya starts next Monday.
