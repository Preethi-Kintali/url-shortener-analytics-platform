# Module 06 FIX: Cache Namespace Separation & Analytics Idempotency

## 1. Problem Identification: Key Collision & Shared Namespace Coupling

### The Mechanism of Failure
Prior to remediation, both the HTTP redirect cache and the asynchronous analytics worker relied on a single overloaded Redis key structure (`link:redirect:<code\>`). 

```
                               ┌────────────────────────────────┐
                               │   Overloaded Redis Namespace   │
                               │    "link:redirect:<code\>"     │
                               └──────┬──────────────────┬──────┘
                                      │                  │
                      Fast URL Lookup │                  │ Deduplication Flag
                                      ▼                  ▼
                            ┌────────────────┐    ┌────────────────┐
                            │ Redirect Path  │    │ Queue Worker   │
                            │ (GET /:code)   │    │ (Process Job)  │
                            └────────────────┘    └────────────────┘
```

When Bug #9's cache invalidation fix executed `cache.del("link:redirect:<code\>")` on link deletion, it severed the redirect mapping as intended. However, it simultaneously destroyed the worker's deduplication state. When the short code was subsequently re-created, the worker evaluated the absent key as an indicator that jobs had never been processed, resulting in duplicate execution and doubled analytics counts.

---

## 2. Architectural Remediation: Explicit Disjoint Key Namespaces

The two subsystems have been completely decoupled with dedicated, immutable Redis key prefixes and independent lifecycle TTLs:

1. **Redirect Target Cache**:
   - **Prefix**: `link:redirect:<short_code>`
   - **Payload**: String target destination URL (`https://...`)
   - **TTL**: 300 seconds (5 minutes)
   - **Lifecycle**: Populated on cache miss; purged immediately upon `DELETE /links/:id` or `PATCH /links/:id`.
2. **Analytics Deduplication Flag**:
   - **Prefix**: `analytics:dedup:<job_id>` (or `analytics:dedup:<eventId>`)
   - **Payload**: Processing timestamp / status metadata
   - **TTL**: 86,400 seconds (24 hours)
   - **Lifecycle**: Checked and set during asynchronous worker ingestion; completely decoupled from link deletion or re-creation.

---

## 3. Verification & Invariant Proofs (`test-namespace-separation.js`)

1. **Bug #9 Integrity**:
   - Link deletion deletes only `link:redirect:<code\>`. Subsequent redirects return HTTP 404 immediately.
2. **Namespace Isolation**:
   - Deleting a link preserves all `analytics:dedup:<job_id>` keys intact.
3. **Re-Creation Idempotency**:
   - Re-creating a link with the identical short code does not corrupt historical or in-flight deduplication flags.
   - Retried jobs from prior link lifecycles are recognized as duplicates and safely ignored.
   - New jobs for the re-created link process exactly once.
