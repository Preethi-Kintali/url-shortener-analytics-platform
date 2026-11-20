// ============================================================================
// MODULE 01 STEP 6: FIX — DETERMINISTIC ORDERING & CONCURRENT STABILITY
// ============================================================================
// Remediates non-deterministic ordering and pagination drift under concurrent
// writes by enforcing a deterministic tie-breaker (ORDER BY created_at DESC, id DESC)
// and snapshot/cursor boundary isolation.
// ============================================================================

const assert = require('assert');

class StableLinkRepository {
  constructor() {
    this.links = [];
    this._seed();
  }

  _seed() {
    const baseTime = Date.now() - 100000;
    for (let i = 1; i <= 30; i++) {
      this.links.push({
        id: `lnk_${String(i).padStart(3, '0')}`,
        code: `short_${i}`,
        url: `https://example.com/target/${i}`,
        createdAt: baseTime + i * 1000,
      });
    }
  }

  insert(link) {
    this.links.push({
      ...link,
      createdAt: Date.now(),
    });
  }

  // Fixed Query: Enforces deterministic multi-column sorting
  // ORDER BY created_at DESC, id DESC
  getLinksPaginated(page = 1, limit = 10, snapshotTime = null) {
    const sanitizedPage = Math.max(1, Number(page) || 1);
    const sanitizedLimit = Math.max(1, Number(limit) || 10);

    // Filter to snapshot if snapshot isolation is active
    let pool = this.links;
    if (snapshotTime) {
      pool = pool.filter(item => item.createdAt <= snapshotTime);
    }

    // Deterministic sort: Primary created_at DESC, Secondary unique tie-breaker id DESC
    const sorted = [...pool].sort((a, b) => {
      const timeDiff = b.createdAt - a.createdAt;
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    const skip = (sanitizedPage - 1) * sanitizedLimit;
    const records = sorted.slice(skip, skip + sanitizedLimit);

    return {
      records,
      page: sanitizedPage,
      limit: sanitizedLimit,
      total: sorted.length,
      totalPages: Math.ceil(sorted.length / sanitizedLimit),
    };
  }

  // Cursor-based alternative: Immune to window shift
  getLinksCursor(cursor = null, limit = 10) {
    const sanitizedLimit = Math.max(1, Number(limit) || 10);

    const sorted = [...this.links].sort((a, b) => {
      const timeDiff = b.createdAt - a.createdAt;
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    let startIndex = 0;
    if (cursor) {
      const cursorIndex = sorted.findIndex(item => item.id === cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    const records = sorted.slice(startIndex, startIndex + sanitizedLimit);
    const nextCursor = records.length === sanitizedLimit ? records[records.length - 1].id : null;

    return { records, nextCursor };
  }
}

function verifyDeterministicFix() {
  console.log('================================================================================');
  console.log('MODULE 01 STEP 6: VERIFYING DETERMINISTIC ORDERING FIX');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('================================================================================\n');

  const repo = new StableLinkRepository();

  // Test 1: Deterministic Multi-Column Sort with Snapshot Anchor
  console.log('--- TEST 1: Snapshot-Anchored Deterministic Pagination Under Concurrent Inserts ---');
  const snapshotTime = Date.now();

  console.log('[Page 1] Fetching page 1...');
  const page1 = repo.getLinksPaginated(1, 10, snapshotTime);
  console.log(`Page 1 fetched ${page1.records.length} items. [${page1.records[0].id} .. ${page1.records[9].id}]`);

  console.log('\n[CONCURRENT INSERT] Inserting 5 new links into repository while user browses...');
  for (let i = 1; i <= 5; i++) {
    repo.insert({ id: `lnk_concurrent_${i}`, code: `c_${i}`, url: `https://example.com/c/${i}` });
  }

  console.log('\n[Page 2] Fetching page 2 with snapshot anchor...');
  const page2 = repo.getLinksPaginated(2, 10, snapshotTime);
  console.log(`Page 2 fetched ${page2.records.length} items. [${page2.records[0].id} .. ${page2.records[9].id}]`);

  console.log('\n[Page 3] Fetching page 3 with snapshot anchor...');
  const page3 = repo.getLinksPaginated(3, 10, snapshotTime);
  console.log(`Page 3 fetched ${page3.records.length} items. [${page3.records[0].id} .. ${page3.records[9].id}]`);

  // Verify zero duplicates across all 3 pages
  const allIds = [
    ...page1.records.map(r => r.id),
    ...page2.records.map(r => r.id),
    ...page3.records.map(r => r.id),
  ];

  const uniqueIds = new Set(allIds);
  console.log(`\nTotal items across 3 pages: ${allIds.length}`);
  console.log(`Unique items across 3 pages: ${uniqueIds.size}`);

  assert.strictEqual(allIds.length, 30, 'Expected exactly 30 items across 3 pages of 10 items');
  assert.strictEqual(uniqueIds.size, 30, 'Expected zero duplicates across all 3 pages');
  console.log('[PASS] Test 1: Snapshot pagination eliminated window drift. ZERO duplicates detected under concurrent load!');

  // Test 2: Keyset / Cursor Pagination Immunity
  console.log('\n--- TEST 2: Keyset/Cursor Pagination Under Concurrent Inserts ---');
  const c1 = repo.getLinksCursor(null, 10);
  console.log(`Cursor Page 1: fetched ${c1.records.length} items, nextCursor: ${c1.nextCursor}`);

  // Concurrent write
  repo.insert({ id: 'lnk_cursor_drift_test', code: 'drift', url: 'https://example.com/drift' });

  const c2 = repo.getLinksCursor(c1.nextCursor, 10);
  console.log(`Cursor Page 2: fetched ${c2.records.length} items, nextCursor: ${c2.nextCursor}`);

  const cursorP1Ids = new Set(c1.records.map(r => r.id));
  const cursorDupes = c2.records.filter(r => cursorP1Ids.has(r.id));
  assert.strictEqual(cursorDupes.length, 0, 'Cursor pagination produced duplicate items');
  console.log('[PASS] Test 2: Cursor pagination is mathematically immune to prepended rows. ZERO duplicates detected!');

  console.log('\n================================================================================');
  console.log('STEP 6 FIX VERIFICATION COMPLETE: ALL ASSERTIONS PASSED (100% Green)');
  console.log('================================================================================');
}

verifyDeterministicFix();
