import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-08');
fs.mkdirSync(evidenceDir, { recursive: true });

const testsEvidenceFile = path.join(evidenceDir, 'search-tests.txt');
const queryPlansEvidenceFile = path.join(evidenceDir, 'search-query-plans.txt');

fs.writeFileSync(testsEvidenceFile, '', 'utf8');
fs.writeFileSync(queryPlansEvidenceFile, '', 'utf8');

let passed = 0;
const failures: string[] = [];

function log(msg: string): void {
  console.log(msg);
  fs.appendFileSync(testsEvidenceFile, msg + '\n', 'utf8');
}

function logPlan(msg: string): void {
  fs.appendFileSync(queryPlansEvidenceFile, msg + '\n', 'utf8');
}

function assertCheck(condition: boolean, label: string, details?: string): void {
  if (condition) {
    passed++;
    log(`[PASS] ${label}${details ? ` — ${details}` : ''}`);
  } else {
    const failureMsg = `${label}${details ? ` — ${details}` : ''}`;
    failures.push(failureMsg);
    log(`[FAIL] ${failureMsg}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.killed) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore cleanup errors
      }
      resolve();
    }, 4000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

interface SpawnedApi {
  process: ChildProcess;
  allOutput: () => string;
}

async function startApiServer(port: number): Promise<SpawnedApi> {
  const apiDir = path.resolve(__dirname, '..');
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const child = spawn(process.execPath, [path.join(apiDir, 'dist/main.js')], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk: Buffer) => stdoutLines.push(chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => stderrLines.push(chunk.toString('utf8')));

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) {
      throw new Error(
        `API process exited early with code ${child.exitCode}:\n${[...stdoutLines, ...stderrLines].join('\n')}`,
      );
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.status === 200) {
        return {
          process: child,
          allOutput: () => [...stdoutLines, ...stderrLines].join('\n'),
        };
      }
    } catch {
      // Server booting
    }
    await sleep(250);
  }

  await stopProcess(child);
  throw new Error(
    `API failed to boot on port ${port} within 15s:\n${[...stdoutLines, ...stderrLines].join('\n')}`,
  );
}

async function login(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as { access_token?: string };
  if (res.status !== 200 || !body.access_token) {
    throw new Error(`Login failed for ${email}: status=${res.status}`);
  }
  return body.access_token;
}

function buildSearchWhere(ownerId: string, q?: string, tag?: string): Prisma.LinkWhereInput {
  const andClauses: Prisma.LinkWhereInput[] = [{ createdBy: ownerId }];
  if (q) {
    andClauses.push({
      OR: [
        { longUrl: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (tag) {
    andClauses.push({ tags: { has: tag } });
  }
  return andClauses.length === 1 ? andClauses[0] : { AND: andClauses };
}

async function run(): Promise<void> {
  log('====================================================================');
  log('Module 08: PostgreSQL-Native Search, Tags, Indexes & Query Plan Suite');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('====================================================================\n');

  const queryLogs: Array<{ query: string; params: string }> = [];
  const prisma = new PrismaClient({
    log: [{ emit: 'event', level: 'query' }],
  });
  prisma.$on('query', (e) => {
    queryLogs.push({ query: e.query, params: e.params });
  });

  let api: SpawnedApi | null = null;
  const createdIds: string[] = [];
  const syntheticTenantPrefix = `m8_scale_tenant_${Date.now()}_`;

  try {
    // ------------------------------------------------------------------
    // SECTION A: Seed Scale Dataset (2,400+ rows) & Inspect SQL / Plans
    // ------------------------------------------------------------------
    log('--- SECTION A: PostgreSQL Extensions, Indexes, Generated SQL & EXPLAIN ANALYZE ---');

    const extRows = await prisma.$queryRawUnsafe<
      Array<{ extname: string; extversion: string }>
    >(
      "SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_trgm', 'btree_gin') ORDER BY extname",
    );
    const idxRows = await prisma.$queryRawUnsafe<
      Array<{ indexname: string; indexdef: string }>
    >(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'links' ORDER BY indexname",
    );

    logPlan('=== Installed PostgreSQL Search Extensions ===');
    for (const ext of extRows) {
      logPlan(`${ext.extname}: v${ext.extversion}`);
    }
    logPlan('\n=== Indexes on public.links ===');
    for (const idx of idxRows) {
      logPlan(`${idx.indexname}: ${idx.indexdef}`);
    }

    const indexNames = new Set(idxRows.map((r) => r.indexname));
    assertCheck(
      extRows.some((e) => e.extname === 'pg_trgm') &&
        indexNames.has('links_created_by_created_at_idx') &&
        indexNames.has('links_tags_gin_idx') &&
        indexNames.has('links_long_url_trgm_idx') &&
        indexNames.has('links_code_trgm_idx'),
      'PostgreSQL pg_trgm extension and composite/GIN search indexes exist on links table',
      `indexes=${idxRows.map((i) => i.indexname).join(',')}`,
    );

    // Seed 24,100 interleaved multi-tenant rows so PostgreSQL planner demonstrates every index tier:
    // - 100 rows for m8_bench_owner (small owner slice -> composite B-tree index scan)
    // - 12,000 rows for m8_heavy_owner interleaved with 12,000 synthetic-tenant rows -> pg_trgm & tag GIN BitmapOr/BitmapAnd plans
    const seedBatch: Prisma.LinkCreateManyInput[] = [];
    const baseTimeMs = Date.now() - 30_000_000;
    for (let i = 0; i < 100; i++) {
      const isSpecial = i < 10;
      seedBatch.push({
        code: isSpecial ? `m8c${String(i).padStart(4, '0')}` : `m8b_${i}`,
        longUrl: isSpecial
          ? `https://promo.example.org/spring-launch/item-${i}?utm_source=newsletter`
          : `https://catalog.example.net/archive/dept-${i % 15}/resource-${i}`,
        tags: isSpecial ? ['marketing', 'spring'] : [`dept${i % 10}`, 'archive'],
        createdBy: 'm8_bench_owner',
        createdAt: new Date(baseTimeMs + i * 1000),
      });
    }
    for (let i = 0; i < 12000; i++) {
      const isSpecial = i < 10;
      seedBatch.push({
        code: isSpecial ? `m8h${String(i).padStart(4, '0')}` : `h8_${i}`,
        longUrl: isSpecial
          ? `https://promo.example.org/spring-launch/heavy-${i}?utm_source=vip`
          : `https://catalog.example.net/heavy/dept-${i % 20}/item-${i}`,
        tags: isSpecial ? ['marketing', 'vip'] : [`dept${i % 10}`, 'catalog'],
        createdBy: 'm8_heavy_owner',
        createdAt: new Date(baseTimeMs + i * 2000),
      });
      seedBatch.push({
        code: `s8_${i}`,
        longUrl: `https://other.example.net/dept-${i % 15}/resource-${i}`,
        tags: [`dept${i % 10}`, 'archive'],
        createdBy: `${syntheticTenantPrefix}${i % 50}`,
        createdAt: new Date(baseTimeMs + i * 2000 + 1),
      });
    }
    await prisma.link.createMany({ data: seedBatch });
    await prisma.$executeRawUnsafe('VACUUM ANALYZE "links"');

    // Capture exact Prisma-generated SQL for representative search combinations
    const scenarios: Array<{ label: string; owner: string; q?: string; tag?: string }> = [
      { label: 'URL & Code Substring Search (heavy owner, q="spring-launch")', owner: 'm8_heavy_owner', q: 'spring-launch' },
      { label: 'Short Code Substring Search (heavy owner, q="m8h00")', owner: 'm8_heavy_owner', q: 'm8h00' },
      { label: 'Tag Filter Search (tag="marketing")', owner: 'm8_heavy_owner', tag: 'marketing' },
      { label: 'Combined URL + Tag Search (q="spring-launch", tag="marketing")', owner: 'm8_heavy_owner', q: 'spring-launch', tag: 'marketing' },
      { label: 'Owner-Scoped Baseline (no q/tag)', owner: 'm8_bench_owner' },
    ];

    logPlan('\n=== Representative Prisma-Generated SQL & EXPLAIN ANALYZE Plans (10,000+ rows) ===');
    const planSummaries: Record<string, string> = {};

    for (const s of scenarios) {
      const beforeIdx = queryLogs.length;
      const where = buildSearchWhere(s.owner, s.q, s.tag);
      await prisma.link.findMany({
        where,
        skip: 0,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      await prisma.link.count({ where });
      const captured = queryLogs.slice(beforeIdx);

      logPlan(`\n--- ${s.label} ---`);
      for (const entry of captured) {
        logPlan(`SQL: ${entry.query}`);
        logPlan(`PARAMS: ${entry.params}`);
      }

      // Run EXPLAIN ANALYZE matching the main data query shape
      const selectSql = captured[0].query;
      const selectParams = JSON.parse(captured[0].params) as unknown[];
      const explainRows = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN (ANALYZE, BUFFERS) ${selectSql}`,
        ...selectParams,
      );
      const planText = explainRows.map((r) => r['QUERY PLAN']).join('\n');
      logPlan('EXPLAIN ANALYZE:');
      logPlan(planText);
      planSummaries[s.label] = planText;
    }

    assertCheck(
      planSummaries['URL & Code Substring Search (heavy owner, q="spring-launch")'].includes('links_long_url_trgm_idx') &&
        planSummaries['URL & Code Substring Search (heavy owner, q="spring-launch")'].includes('links_code_trgm_idx') &&
        !planSummaries['URL & Code Substring Search (heavy owner, q="spring-launch")'].includes('Seq Scan on links'),
      'EXPLAIN ANALYZE uses pg_trgm GIN indexes (links_long_url_trgm_idx + links_code_trgm_idx) without Seq Scan on links',
    );
    assertCheck(
      planSummaries['Tag Filter Search (tag="marketing")'].includes('links_tags_gin_idx') &&
        !planSummaries['Tag Filter Search (tag="marketing")'].includes('Seq Scan on links'),
      'EXPLAIN ANALYZE uses GIN array index (links_tags_gin_idx) for tag filtering without Seq Scan',
    );
    assertCheck(
      planSummaries['Owner-Scoped Baseline (no q/tag)'].includes('links_created_by_created_at_idx') &&
        !planSummaries['Owner-Scoped Baseline (no q/tag)'].includes('Seq Scan on links'),
      'EXPLAIN ANALYZE uses composite B-tree index (links_created_by_created_at_idx) for owner-scoped ordering',
    );

    // Cleanup scale benchmark seed rows before running clean HTTP behavioral suite
    await prisma.link.deleteMany({
      where: {
        OR: [
          { createdBy: { in: ['m8_bench_owner', 'm8_heavy_owner'] } },
          { createdBy: { startsWith: syntheticTenantPrefix } },
        ],
      },
    });

    // ------------------------------------------------------------------
    // SECTION B: Live HTTP API Functional, Auth/IDOR, Pagination & Validation
    // ------------------------------------------------------------------
    log('\n--- SECTION B: Live GET /links/search Behavior, Auth/IDOR & Validation (Port 3128) ---');
    api = await startApiServer(3128);
    const baseUrl = 'http://127.0.0.1:3128';

    const aliceToken = await login(baseUrl, 'alice@example.com', 'dev-alice-secret-01');
    const bobToken = await login(baseUrl, 'bob@example.com', 'dev-bob-secret-02');

    // 1. Unauthenticated request -> 401
    const unauthRes = await fetch(`${baseUrl}/links/search?q=example`);
    assertCheck(
      unauthRes.status === 401,
      'Unauthenticated GET /links/search returns HTTP 401',
      `status=${unauthRes.status}`,
    );

    // 2. Reject principal_id query parameter -> 400 (forbidNonWhitelisted)
    const spoofingRes = await fetch(`${baseUrl}/links/search?principal_id=principal_b`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assertCheck(
      spoofingRes.status === 400,
      'GET /links/search rejects principal_id query parameter with HTTP 400',
      `status=${spoofingRes.status}`,
    );

    // 3. Create tagged links for Alice & Bob (verifying tag persistence + normalization)
    const aliceFixtures = [
      {
        long_url: 'https://shop.example.com/Campaign-Alpha/shoes',
        tags: ['  Marketing ', 'Spring-Sale', 'marketing'],
      },
      {
        long_url: 'https://blog.example.com/campaign-alpha/guide',
        tags: ['docs', 'MARKETING'],
      },
      {
        long_url: 'https://docs.example.org/api/v2/webhooks',
        tags: ['docs', 'engineering'],
      },
      {
        long_url: 'https://shop.example.com/summer-clearance/hat',
        tags: ['spring-sale'],
      },
      {
        long_url: 'https://portal.example.net/account/billing',
        tags: [],
      },
    ];

    const aliceCreated: Array<{ id: string; code: string; long_url: string; tags: string[] }> = [];
    for (const fixture of aliceFixtures) {
      const res = await fetch(`${baseUrl}/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify(fixture),
      });
      const body = (await res.json()) as { id: string; code: string; long_url: string; tags: string[] };
      if (res.status !== 201) {
        throw new Error(`Failed creating Alice link fixture: status=${res.status}`);
      }
      createdIds.push(body.id);
      aliceCreated.push(body);
      await sleep(15); // Distinct created_at timestamps for deterministic DESC paging
    }

    const bobRes = await fetch(`${baseUrl}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({
        long_url: 'https://bob-private.example.com/Campaign-Alpha/secret-deal',
        tags: ['marketing', 'bob-only'],
      }),
    });
    const bobLink = (await bobRes.json()) as { id: string; code: string; tags: string[] };
    createdIds.push(bobLink.id);

    assertCheck(
      JSON.stringify(aliceCreated[0].tags) === JSON.stringify(['marketing', 'spring-sale']),
      'POST /links normalizes, deduplicates, and persists tags into PostgreSQL',
      `tags=${JSON.stringify(aliceCreated[0].tags)}`,
    );

    // 4. Case-insensitive URL substring search + IDOR owner isolation
    const urlSearchRes = await fetch(`${baseUrl}/links/search?q=CAMPAIGN-ALPHA`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const urlSearchBody = (await urlSearchRes.json()) as {
      data: Array<{ id: string; long_url: string; tags: string[] }>;
      pagination: { page: number; page_size: number; total: number };
    };
    const urlIds = new Set(urlSearchBody.data.map((d) => d.id));
    assertCheck(
      urlSearchRes.status === 200 &&
        urlIds.has(aliceCreated[0].id) &&
        urlIds.has(aliceCreated[1].id) &&
        !urlIds.has(bobLink.id) &&
        urlSearchBody.pagination.page === 1 &&
        urlSearchBody.pagination.page_size === 20 &&
        urlSearchBody.pagination.total === 2,
      'Case-insensitive URL substring search (?q=CAMPAIGN-ALPHA) returns only Alice matching links',
      `total=${urlSearchBody.pagination.total}`,
    );

    // 5. Short-code search (case-insensitive substring of generated code)
    const codeSlice = aliceCreated[2].code.slice(1, 6).toUpperCase();
    const codeSearchRes = await fetch(`${baseUrl}/links/search?q=${encodeURIComponent(codeSlice)}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const codeSearchBody = (await codeSearchRes.json()) as {
      data: Array<{ id: string; code: string }>;
      pagination: { total: number };
    };
    assertCheck(
      codeSearchRes.status === 200 &&
        codeSearchBody.data.some((d) => d.id === aliceCreated[2].id),
      'GET /links/search supports case-insensitive short code matching',
      `slice=${codeSlice}, hits=${codeSearchBody.pagination.total}`,
    );

    // 6. Tag filter only (case-insensitive)
    const tagSearchRes = await fetch(`${baseUrl}/links/search?tag=DOCS`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const tagSearchBody = (await tagSearchRes.json()) as {
      data: Array<{ id: string }>;
      pagination: { total: number };
    };
    assertCheck(
      tagSearchRes.status === 200 &&
        tagSearchBody.pagination.total === 2 &&
        tagSearchBody.data.every((d) => d.id === aliceCreated[1].id || d.id === aliceCreated[2].id),
      'Tag filter (?tag=DOCS) matches only Alice links carrying normalized tag docs',
      `total=${tagSearchBody.pagination.total}`,
    );

    // 7. Combined q + tag filter (AND semantics)
    const combinedRes = await fetch(`${baseUrl}/links/search?q=shop.example.com&tag=marketing`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const combinedBody = (await combinedRes.json()) as {
      data: Array<{ id: string }>;
      pagination: { total: number };
    };
    assertCheck(
      combinedRes.status === 200 &&
        combinedBody.pagination.total === 1 &&
        combinedBody.data[0]?.id === aliceCreated[0].id,
      'Combined q + tag filters intersect cleanly with AND semantics',
      `total=${combinedBody.pagination.total}`,
    );

    // 8. Owner isolation from Bob's side (cannot find Alice-only URL/tag)
    const bobIsolationRes = await fetch(`${baseUrl}/links/search?q=docs.example.org&tag=engineering`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    const bobIsolationBody = (await bobIsolationRes.json()) as {
      data: unknown[];
      pagination: { page: number; page_size: number; total: number };
    };
    assertCheck(
      bobIsolationRes.status === 200 &&
        bobIsolationBody.data.length === 0 &&
        bobIsolationBody.pagination.total === 0,
      'Cross-owner search isolation prevents Bob from seeing Alice matching links',
      `total=${bobIsolationBody.pagination.total}`,
    );

    // 9. Pagination correctness across pages (example.com / docs / alice fixtures)
    const p1Res = await fetch(`${baseUrl}/links/search?q=example&page=1&page_size=2`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const p2Res = await fetch(`${baseUrl}/links/search?q=example&page=2&page_size=2`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const p3Res = await fetch(`${baseUrl}/links/search?q=example&page=3&page_size=2`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const p1Body = (await p1Res.json()) as { data: Array<{ id: string }>; pagination: { page: number; page_size: number; total: number } };
    const p2Body = (await p2Res.json()) as { data: Array<{ id: string }>; pagination: { page: number; page_size: number; total: number } };
    const p3Body = (await p3Res.json()) as { data: Array<{ id: string }>; pagination: { page: number; page_size: number; total: number } };

    const pagedIds = [...p1Body.data, ...p2Body.data, ...p3Body.data].map((d) => d.id);
    const uniquePagedIds = new Set(pagedIds);
    assertCheck(
      p1Res.status === 200 &&
        p2Res.status === 200 &&
        p3Res.status === 200 &&
        p1Body.data.length === 2 &&
        p2Body.data.length === 2 &&
        p1Body.pagination.page === 1 &&
        p1Body.pagination.page_size === 2 &&
        p2Body.pagination.page === 2 &&
        p1Body.pagination.total >= 5 &&
        uniquePagedIds.size === pagedIds.length,
      'Pagination returns accurate slices, exact { page, page_size, total } metadata, and zero duplicates across pages',
      `total=${p1Body.pagination.total}, fetchedUnique=${uniquePagedIds.size}`,
    );

    // 10. Invalid pagination & malformed inputs -> HTTP 400
    const invalidQueries = [
      'page=0',
      'page=-1',
      'page=1.5',
      'page=abc',
      'page=',
      'page_size=0',
      'page_size=-5',
      'page_size=101',
      'page_size=2.5',
      'page_size=xyz',
      'page_size=',
      `q=${'a'.repeat(201)}`,
      'q=bad%0Aline',
      'tag=bad%09tab',
      'unknown_param=1',
    ];
    const invalidStatuses: Array<{ qs: string; status: number }> = [];
    for (const qs of invalidQueries) {
      const r = await fetch(`${baseUrl}/links/search?${qs}`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      invalidStatuses.push({ qs, status: r.status });
    }
    assertCheck(
      invalidStatuses.every((x) => x.status === 400),
      'Invalid pagination, oversized q, control chars, and extra params all return HTTP 400',
      `checked=${invalidStatuses.length}/15`,
    );

    // 11. Empty search results -> HTTP 200 with canonical empty shape
    const emptyRes = await fetch(`${baseUrl}/links/search?q=no-such-url-sentinel-99999`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const emptyBody = (await emptyRes.json()) as {
      data: unknown[];
      pagination: { page: number; page_size: number; total: number };
    };
    assertCheck(
      emptyRes.status === 200 &&
        Array.isArray(emptyBody.data) &&
        emptyBody.data.length === 0 &&
        emptyBody.pagination.page === 1 &&
        emptyBody.pagination.page_size === 20 &&
        emptyBody.pagination.total === 0,
      'Empty search returns HTTP 200 with { data: [], pagination: { page: 1, page_size: 20, total: 0 } }',
    );

    // 12. Existing CRUD + PATCH tags update + GET /links backward compatibility
    const patchRes = await fetch(`${baseUrl}/links/${aliceCreated[4].id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        long_url: 'https://portal.example.net/account/billing-v2',
        tags: ['Billing', 'Priority'],
      }),
    });
    const patchBody = (await patchRes.json()) as { tags: string[]; long_url: string };
    const tagAfterPatchRes = await fetch(`${baseUrl}/links/search?tag=priority`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const tagAfterPatchBody = (await tagAfterPatchRes.json()) as { data: Array<{ id: string }> };
    assertCheck(
      patchRes.status === 200 &&
        JSON.stringify(patchBody.tags) === JSON.stringify(['billing', 'priority']) &&
        tagAfterPatchBody.data.some((d) => d.id === aliceCreated[4].id),
      'PATCH /links/:id updates tags cleanly and immediately reflects in search queries',
    );

    // 13. Log safety: raw search query / destination URL / JWT never logged
    const logs = api.allOutput();
    assertCheck(
      !logs.includes('Campaign-Alpha') &&
        !logs.includes('CAMPAIGN-ALPHA') &&
        !logs.includes('secret-deal') &&
        !logs.includes(aliceToken) &&
        !logs.includes(bobToken),
      'Server logs never expose destination URLs, raw search terms, or JWTs',
    );
  } finally {
    if (createdIds.length > 0) {
      await prisma.link.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
    }
    await prisma.link
      .deleteMany({
        where: {
          OR: [
            { createdBy: { in: ['m8_bench_owner', 'm8_heavy_owner'] } },
            { createdBy: { startsWith: syntheticTenantPrefix } },
          ],
        },
      })
      .catch(() => {});
    if (api) {
      await stopProcess(api.process);
    }
    await prisma.$disconnect();
  }

  log('\n====================================================================');
  log(`SUMMARY: passed=${passed}, failed=${failures.length}`);
  log('====================================================================');
  log(`Evidence saved to: ${testsEvidenceFile}`);
  log(`Query plans saved to: ${queryPlansEvidenceFile}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

