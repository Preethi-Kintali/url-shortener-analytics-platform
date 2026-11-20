# RFC: Public API Rate Limiting Architecture

**Status:** Proposed  
**Audience:** Senior Backend Engineers and Infrastructure Team

## 1. Problem Statement

Our public API currently has no rate-limiting mechanism. This creates three major problems.

- **Service availability:** A single client accidentally sent 50,000 requests per minute, increasing API latency and affecting other customers.
- **Operational overhead:** The on-call engineer had to manually block the API key and redeploy the service, making incident response slow and dependent on manual intervention.
- **Business limitations:** The product team cannot introduce paid subscription tiers with guaranteed API quotas without a mechanism to enforce different client limits.

We need a centralized rate-limiting system that protects service availability, isolates clients, reduces operational effort, and supports future monetization.

## 2. Proposed Approach

I propose implementing rate limiting at the API Gateway using a Token Bucket algorithm and Redis as centralized state storage.

### Architecture

1. A client sends a request with its API key.
2. The API Gateway identifies the client and retrieves its subscription tier and configured quota.
3. Gateway middleware checks the client's token bucket in Redis.
4. If tokens are available, one token is consumed and the request proceeds to the application service.
5. If no tokens are available, the gateway rejects the request with HTTP 429.

### Algorithm: Token Bucket

Each client has a bucket with a configurable maximum capacity and token refill rate.

- Each incoming request consumes one token.
- Tokens are replenished at a configured rate.
- Unused tokens can accumulate up to the bucket capacity.
- Requests exceeding the available tokens are rejected.

This allows short bursts while controlling the client's average request rate.

### State Storage: Redis

I propose Redis because the API may run across multiple gateway instances. A shared Redis store ensures that all instances use consistent client quota information.

The token refill and consumption operation should be atomic, using a Redis Lua script to prevent concurrent requests from consuming the same available token.

### Client Feedback

Rejected requests will return:

- `429 Too Many Requests`
- `Retry-After`: Indicates when the client can retry.
- `X-RateLimit-Limit`: Maximum allowed quota.
- `X-RateLimit-Remaining`: Remaining available requests.
- `X-RateLimit-Reset`: Time when the quota resets or becomes available again, according to the documented policy.

We will also collect metrics for rejected requests, Redis latency, quota usage, and client-level traffic.

## 3. Alternatives Considered

### Alternative 1: In-Memory Rate Limiting

Each API server maintains its own request counters.

**Advantages:**
- Simple to implement.
- No external storage dependency.
- Very low checking latency.

**Disadvantages:**
- Each server maintains independent counters.
- A client can bypass its intended quota by sending requests across multiple instances.
- Counters are lost when instances restart.

**Decision:** Not selected because it cannot reliably enforce global client quotas in a distributed deployment.

### Alternative 2: Managed API Gateway or Cloud-Based Rate Limiting

Use a managed service such as AWS API Gateway or Cloudflare to handle rate limiting.

**Advantages:**
- Reduces infrastructure maintenance.
- Provides built-in traffic protection and monitoring.
- Can simplify deployment and scaling.

**Disadvantages:**
- Fine-grained subscription-tier enforcement may require additional integration.
- Custom quota logic and dynamic per-tenant configuration may be constrained by the provider.
- Introduces provider-specific configuration and potential vendor dependency.

**Decision:** Worth evaluating, especially if the existing infrastructure already uses a compatible managed gateway. However, a custom gateway middleware with Redis provides more control over our internal quota rules.

## 4. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Redis becomes unavailable | Use a short fail-open period for ordinary traffic to preserve availability, combined with a local emergency limit and alerts. Apply stricter protection to suspicious traffic and define a recovery policy. |
| Additional request latency | Use efficient Redis operations, connection pooling, appropriate timeouts, and latency monitoring. |
| Redis overload | Monitor traffic patterns, optimize key usage, and scale Redis based on measured load. |
| Incorrect quota configuration | Validate tier configurations and test quota enforcement before releasing paid plans. |
| Doing nothing | Introduce rate limiting to prevent noisy-neighbor incidents, reduce operational firefighting, and unblock paid-tier monetization. |

The fail-open behavior must be explicitly configurable. We should not silently allow unlimited traffic during a Redis outage.

## 5. Open Questions

1. What should the default request limits and burst capacities be for Free, Basic, and Paid tiers?
2. Should quotas be enforced per API key, organization, or both?
3. How should unauthenticated traffic be limited: by IP address or another client identifier?
4. Should certain critical endpoints have separate rate limits?
5. What is the acceptable Redis latency overhead for each API request?
6. Should paid customers receive a different outage policy or emergency quota behavior?
7. Who will own subscription-tier configuration and quota updates?

## Recommendation

Proceed with a centralized API Gateway rate limiter using Redis and the Token Bucket algorithm. Finalize quota values, failure behavior, and tenant identification rules with the product and infrastructure teams before implementation.

This approach addresses the immediate availability problem while providing a foundation for subscription-based API monetization.
