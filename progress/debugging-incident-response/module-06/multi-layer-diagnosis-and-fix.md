# Module 06 BUILD: Multi-Layer Bug Diagnosis & Architectural Hardening

## 1. Bug #9: Stale Cache Serving Deleted Records

### Defect Symptoms
- **Report**: Deleting a short link via `DELETE /links/:id` returns HTTP 200, but public requests to `GET /:shortCode` continue redirecting to the target URL for up to 5 minutes.
- **Hypothesis Formulation**:
  - *Hypothesis 1*: The database delete failed or rolled back silently. *(Disproven: direct SQL SELECT returns 0 rows)*.
  - *Hypothesis 2*: The database record was purged, but the Redis cache layer continues serving the cached redirect mapping. *(Confirmed: Redis key `redirect:<code\>` remains populated)*.

### Root Cause Analysis
The delete handler (`DELETE /links/:id`) invoked `prisma.link.deleteMany()`, which successfully deleted the row from PostgreSQL. However, it never issued an invalidation command to Redis (`cache.del()`). The redirect endpoint (`GET /:shortCode`) queries Redis first and returns the cached URL immediately, bypassing PostgreSQL. Consequently, the deleted link remained active for the duration of the 5-minute cache TTL.

### Hardened Architecture & Fix
In `LinksService.remove()`:
```typescript
async remove(id: string, principalId: string) {
  const existing = await this.prisma.link.findFirst({
    where: { id, createdBy: principalId },
    select: { id: true, code: true }
  });
  if (!existing) throw new NotFoundException();

  await this.prisma.link.deleteMany({ where: { id, createdBy: principalId } });

  // Invalidate in-flight coalesced lookups and purge Redis redirect key
  this.invalidateInFlight(existing.code);
  await this.cache.invalidateRedirectTarget(existing.code);
  return { deleted: true, id };
}
```

---

## 2. Bug #10: Queue Retry Storm & Resource Contention

### Defect Symptoms
- **Report**: The API suddenly becomes unresponsive. Requests hang indefinitely, health checks time out, and monitoring alerts fire. No crash or error logs are recorded in the API service.
- **Hypothesis Formulation**:
  - *Hypothesis 1*: Node.js event loop deadlock or infinite loop. *(Disproven: CPU utilization is low/normal, no call stack lockup)*.
  - *Hypothesis 2*: Connection pool exhaustion on shared PostgreSQL database. *(Confirmed: 100% pool utilization, active connections = maxConnections, wait queue growing indefinitely)*.

### Forensic Chain of Causation
1. An asynchronous background queue job fails (e.g. downstream network blip).
2. The queue worker immediately retries with zero backoff delay (`while(true)` tight loop).
3. Each retry attempt checks out a PostgreSQL database connection from the **shared** connection pool.
4. The worker encounters the same error and retries immediately without releasing or recycling connection slots properly.
5. In seconds, all 10 available database connections are monopolized by the worker.
6. Incoming user-facing API HTTP requests attempt to acquire a database connection and are queued indefinitely.
7. Express/NestJS worker threads block awaiting database connections; HTTP health checks time out.

### Three-Pillar Hardening Strategy
1. **Exponential Backoff**:
   Retry delay doubles on each attempt with a maximum ceiling:
   $$\text{delay} = \min(100 \times 2^{\text{attempt}}, 30000)\text{ ms}$$
2. **Maximum Retries & Dead-Letter Queue (DLQ)**:
   Limit retries to 5 attempts. Once exceeded, route the job to `analytics:dlq` for forensic inspection, preventing infinite loops.
3. **Bulkhead Resource Isolation**:
   Decouple connection pools. Background workers and user-facing API routes must never share a single connection pool. The queue worker operates on a dedicated pool (e.g. 5 connections), leaving the API pool (15 connections) 100% insulated from background worker retry pressure.

---

## 3. Empirical Verification Suite (`test-bugs-9-and-10.js`)
- **Bug #9 Reproduction**: Verified that without cache purge, `GET /:code` returns HTTP 302 from cache for deleted records.
- **Bug #9 Remediated**: Verified that hardened delete purges Redis cache, returning HTTP 404 immediately.
- **Bug #10 Reproduction**: Verified that an unconstrained worker retry loop saturates shared pool to 100%, causing API connection acquisition failure.
- **Bug #10 Remediated**: Verified exponential backoff schedule `[100ms, 200ms, 400ms, 800ms, 1600ms]`, DLQ routing after attempt 5, and 100% successful API request execution on the isolated bulkhead pool.
