// ============================================================================
// MODULE 01 STEP 5: BREAK — CONCURRENT PAGINATION DRIFT REPRODUCTION
// ============================================================================
// Demonstrates how offset-based pagination produces duplicate items across pages
// when concurrent writes occur between page fetches, or when sorting lacks a
// unique tie-breaker column.
// ============================================================================

const assert = require('assert');

class LinkRepository {
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
    // Sort initially by createdAt desc
    this.links.sort((a, b) => b.createdAt - a.createdAt);
  }

  insert(link) {
    this.links.unshift({
      ...link,
      createdAt: Date.now(),
    });
  }

  // Standard Offset Pagination: SELECT * FROM links ORDER BY createdAt DESC OFFSET skip LIMIT take
  getLinksOffset(page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    return this.links.slice(skip, skip + limit);
  }
}

function runConcurrentDriftReproduction() {
  console.log('================================================================================');
  console.log('MODULE 01 STEP 5: BREAK — CONCURRENT PAGINATION DRIFT REPRODUCTION');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('================================================================================\n');

  const repo = new LinkRepository();

  console.log('[STEP 1] User fetches Page 1 (offset: 0, limit: 10)...');
  const page1 = repo.getLinksOffset(1, 10);
  console.log(`Page 1 returned ${page1.length} items. First: ${page1[0].id}, Last: ${page1[page1.length - 1].id}`);

  console.log('\n[STEP 2] Concurrent user activity occurs while user reads Page 1...');
  console.log('Inserting 2 new links at the head of the collection (newest first)...');
  repo.insert({ id: 'lnk_new_001', code: 'promo1', url: 'https://example.com/promo1' });
  repo.insert({ id: 'lnk_new_002', code: 'promo2', url: 'https://example.com/promo2' });
  console.log('2 new links inserted successfully.');

  console.log('\n[STEP 3] User clicks "Next" to fetch Page 2 (offset: 10, limit: 10)...');
  const page2 = repo.getLinksOffset(2, 10);
  console.log(`Page 2 returned ${page2.length} items. First: ${page2[0].id}, Last: ${page2[page2.length - 1].id}`);

  console.log('\n[STEP 4] Analyzing Page 1 vs Page 2 for duplicate drift...');
  const page1Ids = new Set(page1.map(item => item.id));
  const duplicates = page2.filter(item => page1Ids.has(item.id));

  console.log(`Duplicates detected across boundary: ${duplicates.length}`);
  for (const dup of duplicates) {
    console.log(`  -> DUPLICATE DETECTED: Item '${dup.id}' (${dup.code}) was present on Page 1 AND Page 2!`);
  }

  assert(duplicates.length > 0, 'Expected concurrent writes to cause duplicate items across offset pages');
  console.log('\n================================================================================');
  console.log('BREAK CONFIRMED:');
  console.log('Even with 100% correct offset math: skip = (page - 1) * limit,');
  console.log('Offset pagination assumes a STATIC dataset. When concurrent writes prepend rows,');
  console.log('the window shifts, pushing previously seen items into subsequent offset ranges.');
  console.log('================================================================================');
}

runConcurrentDriftReproduction();
