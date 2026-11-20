// ============================================================================
// MODULE 01 BUILD & VERIFICATION TEST: BUG #1 & BUG #2
// ============================================================================
// Bug #1: Environment Variable Mismatch (DB_URL vs DATABASE_URL)
// Bug #2: Pagination Off-By-One Math and Sorting Non-Determinism
// ============================================================================

const assert = require('assert');

function runBug1Demonstration() {
  console.log('--- Testing Bug #1: Configuration Contract Mismatch ---');

  // Broken environment simulation
  const brokenEnv = {
    PORT: '3000',
    DB_URL: 'postgresql://postgres:postgres@localhost:5432/linkops',
    // DATABASE_URL is missing
  };

  function resolveDbUrl(env) {
    if (!env.DATABASE_URL) {
      const err = new Error("PrismaClientInitializationError: Environment variable not found: DATABASE_URL");
      err.code = 'P1012';
      throw err;
    }
    return env.DATABASE_URL;
  }

  // 1. Verify broken state throws connection / env initialization error
  let brokenCaught = false;
  try {
    resolveDbUrl(brokenEnv);
  } catch (err) {
    brokenCaught = true;
    console.log(`[PASS] Bug #1 Broken State: ${err.message}`);
    assert(err.message.includes('DATABASE_URL'));
  }
  assert(brokenCaught, 'Expected broken env to fail when DATABASE_URL is missing');

  // Fixed environment simulation
  const fixedEnv = {
    PORT: '3000',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/linkops',
  };

  const dbUrl = resolveDbUrl(fixedEnv);
  console.log(`[PASS] Bug #1 Fixed State: Resolved DATABASE_URL -> ${dbUrl}`);
  assert.strictEqual(dbUrl, fixedEnv.DATABASE_URL);
}

function runBug2Demonstration() {
  console.log('\n--- Testing Bug #2: Pagination Math & Sorting Invariant ---');

  // Generate 25 deterministic sample links
  const dataset = [];
  const baseTime = Date.now();
  for (let i = 1; i <= 25; i++) {
    dataset.push({
      id: `lnk_${String(i).padStart(3, '0')}`,
      code: `code${i}`,
      url: `https://example.com/target/${i}`,
      createdAt: new Date(baseTime + i * 1000).toISOString(),
    });
  }

  // 1. Broken Pagination Implementation (Off-by-one: offset = page * (limit - 1))
  function paginateBroken(items, page, limit) {
    // Incorrect calculation causing overlap
    const offset = Math.max(0, (page - 1) * limit - (page > 1 ? 1 : 0));
    return items.slice(offset, offset + limit);
  }

  const brokenPage1 = paginateBroken(dataset, 1, 10);
  const brokenPage2 = paginateBroken(dataset, 2, 10);

  const brokenP1Last = brokenPage1[brokenPage1.length - 1];
  const brokenP2First = brokenPage2[0];
  console.log(`[OBSERVATION] Broken Page 1 last item: ${brokenP1Last.id}`);
  console.log(`[OBSERVATION] Broken Page 2 first item: ${brokenP2First.id}`);
  const hasDuplicate = brokenP1Last.id === brokenP2First.id;
  assert(hasDuplicate, 'Expected broken pagination to exhibit overlap on boundary');
  console.log('[PASS] Bug #2 Broken State Confirmed: Duplicate boundary item detected between page 1 and page 2');

  // 2. Fixed Pagination Implementation (offset = (page - 1) * limit with deterministic sort)
  function paginateFixed(items, page, limit) {
    const sanitizedPage = Math.max(1, Number(page) || 1);
    const sanitizedLimit = Math.max(1, Number(limit) || 10);

    // Sort deterministically by createdAt desc, then id desc
    const sorted = [...items].sort((a, b) => {
      const timeCmp = b.createdAt.localeCompare(a.createdAt);
      if (timeCmp !== 0) return timeCmp;
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

  const fixedP1 = paginateFixed(dataset, 1, 10);
  const fixedP2 = paginateFixed(dataset, 2, 10);
  const fixedP3 = paginateFixed(dataset, 3, 10);

  assert.strictEqual(fixedP1.records.length, 10);
  assert.strictEqual(fixedP2.records.length, 10);
  assert.strictEqual(fixedP3.records.length, 5);

  const p1Ids = new Set(fixedP1.records.map(r => r.id));
  const p2Ids = new Set(fixedP2.records.map(r => r.id));
  const p3Ids = new Set(fixedP3.records.map(r => r.id));

  // Verify zero overlap across all pages
  for (const id of p2Ids) {
    assert(!p1Ids.has(id), `Duplicate ID '${id}' found between Page 1 and Page 2`);
  }
  for (const id of p3Ids) {
    assert(!p2Ids.has(id), `Duplicate ID '${id}' found between Page 2 and Page 3`);
    assert(!p1Ids.has(id), `Duplicate ID '${id}' found between Page 1 and Page 3`);
  }

  const allFetched = [...fixedP1.records, ...fixedP2.records, ...fixedP3.records];
  assert.strictEqual(allFetched.length, 25);
  console.log('[PASS] Bug #2 Fixed State Confirmed: 25 items across 3 pages with 0 duplicate boundaries and 100% partition coverage');
}

function main() {
  console.log('================================================================================');
  console.log('MODULE 01 DIAGNOSTIC HARNESS: REPRODUCTION & VERIFICATION OF BUGS 1 & 2');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('================================================================================\n');

  runBug1Demonstration();
  runBug2Demonstration();

  console.log('\n================================================================================');
  console.log('ALL DIAGNOSTIC ASSERTIONS PASSED (100% Green)');
  console.log('================================================================================');
}

main();
