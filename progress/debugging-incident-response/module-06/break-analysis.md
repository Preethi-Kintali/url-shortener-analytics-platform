# Module 06 BREAK: Duplicate Analytics Regression on Re-Created Links

## 1. Problem Description & Telemetry Findings

### Defect Symptoms
- **Report**: Following the deployment of the cache invalidation fix for Bug #9, the analytics team reported duplicate analytics events. Whenever a short link is deleted and subsequently re-created with the same short code, click analytics for that link process twice or double in count.
- **Trigger Condition**:
  1. Link A created with short code `C` (`linkId: UUID-1`).
  2. Users click Link A, generating asynchronous analytics jobs queued in Redis.
  3. Link A deleted via `DELETE /links/:id` (triggering `cache.del('redirect:C')`).
  4. Link B re-created with the identical short code `C` (`linkId: UUID-2`).
  5. Analytics queue worker processes jobs, recording double click counts for Link B.

---

## 2. Hypothesis Formulation & Causal Analysis

### Primary Hypothesis: Shared Code-Based Identifier Binding & Asynchronous Queue Lag
- **The Lifecycle Desynchronization**:
  The redirect cache invalidation fix succeeded in purging the redirect target immediately. This allowed users to re-create the short code `C` instantaneously without waiting for the 5-minute cache TTL.
- **The Queue-to-Database Handoff Flaw**:
  When analytics events are enqueued during redirect resolution, if the job payload only carries the mutable `code` (or if the worker resolves `linkId` via `prisma.link.findUnique({ where: { code } })` at execution time rather than at click time), in-flight jobs from the *deleted* link (`UUID-1`) remain in the queue.
  When the worker eventually pulls those jobs, it looks up `code = C` in PostgreSQL. Because Link B has already been created with `code = C`, the worker erroneously attributes the old clicks to Link B (`UUID-2`), causing its metrics to immediately double.

### Alternative Contributing Factor: Invalidation Collisions
- If cache invalidation inadvertently cleared analytics deduplication keys sharing the `code` namespace, previously processed click events would lose their deduplication marker upon re-creation, causing reprocessing.

---

## 3. Empirical Reproduction (`break-repro-duplicate-analytics.js`)
- **Simulated Workflow**:
  - Enqueued 2 click jobs for `launch24` under `UUID-1`.
  - Deleted `launch24` and invalidated redirect cache.
  - Re-created `launch24` under `UUID-2` and enqueued 1 new click job.
  - Worker resolved jobs by `code`: recorded 3 clicks for `UUID-2` instead of 1 (200% artificial inflation).
- **Conclusion**:
  Multi-layer contracts must decouple mutable routing keys (`shortCode`) from immutable entity identities (`linkId`), and asynchronous queues must enforce strict entity binding at the ingress boundary.
