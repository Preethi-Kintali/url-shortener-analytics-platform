# Debugging & Incident Response — Module 01 Step 6: FIX

**Session ID**: `nio880GmEu6L7HqkpqO90`  
**Skill**: Debugging & Incident Response (`debugging-incident-response`)  
**Pack**: Launchpad (`spk_debugging_incident_response_launchpad`)  
**Module**: Module 01 — Hypothesis-First Debugging  
**Step**: Step 6: FIX (`fix`)  
**Timestamp**: 2026-11-19T10:56:50Z  
**Fix Status**: **VERIFIED GREEN (Zero Duplicates Under Concurrent Writes)**  

---

## 1. The Realized Failure Mode: Non-Deterministic Ordering & Window Drift

In Step 5 BREAK, we established that correct offset math (`skip = (page - 1) * limit`) is necessary but insufficient for production pagination. Pagination fails silently under two conditions:
1. **Omission of Explicit Multi-Column Sorting**: Without `ORDER BY created_at DESC, id DESC`, the database engine provides no ordering guarantees. Queries executed in rapid succession or under internal vacuuming return shifting row orders.
2. **Concurrent Write Window Shift**: When new records are inserted at the head of a descending collection, existing rows shift down by $K$ positions, causing already-read records to be re-read in subsequent offset ranges.

---

## 2. The Engineering Fix: Deterministic Ordering & Snapshot Isolation

### 2.1 Enforcing Deterministic Sorting
The query was refactored to require a compound, guaranteed-unique sort order:
```sql
SELECT id, code, target_url, created_at
FROM links
WHERE created_at <= $snapshotTime
ORDER BY created_at DESC, id DESC
OFFSET $skip LIMIT $limit;
```
- **Primary Sort**: `created_at DESC` ensures newest links appear first.
- **Secondary Tie-Breaker**: `id DESC` guarantees that if two records share the identical millisecond timestamp, their relative position is 100% deterministic and invariant across query runs.

### 2.2 Eliminating Window Drift via Snapshot Anchor & Cursor Pagination
Two production-grade approaches were implemented and validated:
1. **Snapshot-Anchored Offset Pagination**: The client or API pins the initial query timestamp (`snapshotTime = now()`). Subsequent page fetches include `WHERE created_at <= $snapshotTime`, preventing newly prepended records from shifting the pagination offset window.
2. **Keyset / Cursor Pagination**: The API returns an opaque cursor (`nextCursor = lastItem.id`), and subsequent queries execute `WHERE (created_at, id) < ($cursorTime, $cursorId) LIMIT $limit`. This query is immune to prepended rows because it anchors directly to the record boundary rather than an absolute numeric offset.

---

## 3. Empirical Verification Under Concurrent Load

The fix was verified using [test-deterministic-pagination-fix.js](test-deterministic-pagination-fix.js):

```text
================================================================================
MODULE 01 STEP 6: VERIFYING DETERMINISTIC ORDERING FIX
Timestamp: 2026-11-19T05:26:39.485Z
================================================================================

--- TEST 1: Snapshot-Anchored Deterministic Pagination Under Concurrent Inserts ---
[Page 1] Fetching page 1...
Page 1 fetched 10 items. [lnk_030 .. lnk_021]

[CONCURRENT INSERT] Inserting 5 new links into repository while user browses...

[Page 2] Fetching page 2 with snapshot anchor...
Page 2 fetched 10 items. [lnk_020 .. lnk_011]

[Page 3] Fetching page 3 with snapshot anchor...
Page 3 fetched 10 items. [lnk_010 .. lnk_001]

Total items across 3 pages: 30
Unique items across 3 pages: 30
[PASS] Test 1: Snapshot pagination eliminated window drift. ZERO duplicates detected under concurrent load!

--- TEST 2: Keyset/Cursor Pagination Under Concurrent Inserts ---
Cursor Page 1: fetched 10 items, nextCursor: lnk_026
Cursor Page 2: fetched 10 items, nextCursor: lnk_016
[PASS] Test 2: Cursor pagination is mathematically immune to prepended rows. ZERO duplicates detected!

================================================================================
STEP 6 FIX VERIFICATION COMPLETE: ALL ASSERTIONS PASSED (100% Green)
================================================================================
```

### Verification Highlights:
- **30 Total Items Requested**: Across 3 pages of 10 items each.
- **30 Unique Items Returned**: Exactly 0 duplicates across boundaries (`lnk_030` through `lnk_001`).
- **Concurrent Writes Handled**: 5 new items were inserted between Page 1 and Page 2 without causing any duplicate drift or omitted records.
