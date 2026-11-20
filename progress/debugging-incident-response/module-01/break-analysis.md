# Debugging & Incident Response — Module 01 Step 5: BREAK

**Session ID**: `nio880GmEu6L7HqkpqO90`  
**Skill**: Debugging & Incident Response (`debugging-incident-response`)  
**Pack**: Launchpad (`spk_debugging_incident_response_launchpad`)  
**Module**: Module 01 — Hypothesis-First Debugging  
**Step**: Step 5: BREAK (`break`)  
**Timestamp**: 2026-11-19T10:54:00Z  

---

## 1. Incident Overview: Intermittent Duplicate Rows Under Concurrent Writes

After remediating Bug #2's off-by-one formula (`skip = (page - 1) * limit`), the pagination test passed consistently in single-user sequential tests. However, under simulated concurrent writes (users creating links while another user browses admin pages), **intermittent duplicate items reappeared across page boundaries**.

```text
[OBSERVATION] Page 1 fetched items lnk_030 through lnk_021.
[CONCURRENT WRITE] 2 new links inserted at the head of the dataset.
[OBSERVATION] Page 2 fetched items lnk_022 through lnk_013.
[ANOMALY] Items 'lnk_022' and 'lnk_021' appeared on BOTH Page 1 and Page 2!
```

---

## 2. Root Cause Analysis: What Besides Offset Math Does Pagination Rely On?

Offset-based pagination (`OFFSET N LIMIT M`) relies on two fundamental, often unstated assumptions:

### 2.1 The Static Dataset Assumption (Window Drift)
Offset pagination assumes that the dataset remains static between page requests.
- When results are sorted by `createdAt DESC` (newest first), inserting $K$ new records prepends them to the front of the dataset.
- This shifts the entire existing collection downward by $K$ positions.
- When the client requests the next page with `OFFSET 10`, the items that originally occupied positions 9 and 10 have now been shifted to positions 11 and 12 (offsets 10 and 11).
- As a result, the second query re-reads the same items that were already displayed on Page 1.
- Conversely, if records are deleted between page fetches, items shift upward and are skipped entirely.

### 2.2 The Deterministic Sort Order Invariant
Even without concurrent writes, if a query orders by `createdAt DESC` alone, multiple records created in the same millisecond or batch share identical sort keys. Without a secondary, strictly unique tie-breaker (such as `id DESC`), the database query planner can return those tied rows in arbitrary order across queries, creating synthetic duplicates or missing items.

### 2.3 Why This Bug is Intermittent
In local unit tests or isolated manual curl checks, queries are executed sequentially against a quiescent database with zero background write activity. The bug only surfaces in production or under concurrent load when write traffic coincides with page transitions.

---

## 3. Empirical Reproduction Proof

The failure was reproduced deterministically using [break-concurrent-pagination-repro.js](break-concurrent-pagination-repro.js):

```text
================================================================================
MODULE 01 STEP 5: BREAK — CONCURRENT PAGINATION DRIFT REPRODUCTION
Timestamp: 2026-11-19T05:23:49.730Z
================================================================================

[STEP 1] User fetches Page 1 (offset: 0, limit: 10)...
Page 1 returned 10 items. First: lnk_030, Last: lnk_021

[STEP 2] Concurrent user activity occurs while user reads Page 1...
Inserting 2 new links at the head of the collection (newest first)...
2 new links inserted successfully.

[STEP 3] User clicks "Next" to fetch Page 2 (offset: 10, limit: 10)...
Page 2 returned 10 items. First: lnk_022, Last: lnk_013

[STEP 4] Analyzing Page 1 vs Page 2 for duplicate drift...
Duplicates detected across boundary: 2
  -> DUPLICATE DETECTED: Item 'lnk_022' (short_22) was present on Page 1 AND Page 2!
  -> DUPLICATE DETECTED: Item 'lnk_021' (short_21) was present on Page 1 AND Page 2!

================================================================================
BREAK CONFIRMED:
Even with 100% correct offset math: skip = (page - 1) * limit,
Offset pagination assumes a STATIC dataset. When concurrent writes prepend rows,
the window shifts, pushing previously seen items into subsequent offset ranges.
================================================================================
```

---

## 4. Formulation of Hypotheses for Step 6 FIX

1. **Hypothesis 1 (Deterministic Tie-Breaker)**: Adding a unique tie-breaker column (`ORDER BY created_at DESC, id DESC`) eliminates non-deterministic sort order variations on identical timestamps.
2. **Hypothesis 2 (Cursor / Keyset Pagination)**: Replacing offset-based pagination with keyset/cursor pagination (`WHERE (created_at, id) < ($cursor_time, $cursor_id) LIMIT $limit`) makes pagination completely immune to prepended concurrent inserts.
3. **Hypothesis 3 (Snapshot Time Filtering)**: In offset pagination, anchoring subsequent page requests to a stable query snapshot timestamp (`WHERE created_at <= $initial_page_timestamp`) prevents newly prepended rows from shifting the pagination window.
