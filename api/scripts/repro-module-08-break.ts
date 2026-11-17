import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-08');
fs.mkdirSync(evidenceDir, { recursive: true });
const outFile = path.join(evidenceDir, 'tsquery-break-repro.txt');
fs.writeFileSync(outFile, '', 'utf8');

let passed = 0;
const failures: string[] = [];

function log(msg: string): void {
  console.log(msg);
  fs.appendFileSync(outFile, msg + '\n', 'utf8');
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

interface SearchRow {
  id: string;
  code: string;
  long_url: string;
  tags: string[];
}

const TSQUERY_BROKEN_SQL = `
SELECT "id", "code", "long_url", "tags"
FROM "public"."links"
WHERE "created_by" = $1
  AND to_tsvector('english', "long_url" || ' ' || regexp_replace("long_url", '[^[:alnum:]]+', ' ', 'g') || ' ' || "code" || ' ' || array_to_string("tags", ' ')) @@ to_tsquery('english', $2)
ORDER BY "created_at" DESC
LIMIT 20
`.trim();

const PLAINTO_TSQUERY_SAFE_SQL = `
SELECT "id", "code", "long_url", "tags"
FROM "public"."links"
WHERE "created_by" = $1
  AND to_tsvector('english', "long_url" || ' ' || regexp_replace("long_url", '[^[:alnum:]]+', ' ', 'g') || ' ' || "code" || ' ' || array_to_string("tags", ' ')) @@ plainto_tsquery('english', $2)
ORDER BY "created_at" DESC
LIMIT 20
`.trim();

function extractPgErrorDetails(err: unknown): { code: string; pgCode: string; message: string } {
  const anyErr = err as { code?: string; meta?: { code?: string; message?: string }; message?: string };
  const code = anyErr?.code ?? 'UNKNOWN';
  const pgCode = anyErr?.meta?.code ?? 'UNKNOWN';
  const rawMessage = anyErr?.meta?.message ?? anyErr?.message ?? String(err);
  const singleLine = rawMessage.replace(/\s+/g, ' ').trim();
  return { code, pgCode, message: singleLine };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const ownerId = `m8_break_repro_${Date.now()}`;

  log('====================================================================');
  log('Module 08 BREAK Reproduction: to_tsquery() vs plainto_tsquery()');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('====================================================================\n');

  log('Parameterized Broken SQL:');
  log(TSQUERY_BROKEN_SQL);
  log('\nParameterized Safe Fix SQL:');
  log(PLAINTO_TSQUERY_SAFE_SQL);
  log('');

  try {
    await prisma.$connect();

    await prisma.link.createMany({
      data: [
        {
          code: 'm8brk01',
          longUrl: 'https://docs.example.com/spring-launch',
          tags: ['docs', 'spring', 'getting-started-guide'],
          createdBy: ownerId,
        },
        {
          code: 'm8brk02',
          longUrl: 'https://shop.example.com/holiday-deals/c/guide?topic=cpp',
          tags: ['shop', 'deals'],
          createdBy: ownerId,
        },
      ],
    });

    const testCases: Array<{
      label: string;
      input: string;
      expectedSafeHits: number;
    }> = [
      {
        label: 'Ordinary multi-word phrase with space',
        input: 'spring launch',
        expectedSafeHits: 1,
      },
      {
        label: 'URL with colon/slashes pasted into search box',
        input: 'https://docs.example.com/spring-launch',
        expectedSafeHits: 1,
      },
      {
        label: 'Ordinary phrase with parentheses',
        input: 'getting started (guide)',
        expectedSafeHits: 1,
      },
      {
        label: 'Trailing punctuation / exclamation mark',
        input: 'deals!',
        expectedSafeHits: 1,
      },
      {
        label: 'Dangling boolean operator in user text',
        input: 'spring &',
        expectedSafeHits: 1,
      },
      {
        label: 'Plus signs in technical term',
        input: 'c++ guide',
        expectedSafeHits: 1,
      },
    ];

    for (const tc of testCases) {
      log(`--- Case: ${tc.label} | input=${JSON.stringify(tc.input)} ---`);

      // 1. Broken to_tsquery() with parameterized SQL ($1, $2)
      let failedAsExpected = false;
      let capturedError = '';
      try {
        await prisma.$queryRawUnsafe<SearchRow[]>(TSQUERY_BROKEN_SQL, ownerId, tc.input);
      } catch (err) {
        const details = extractPgErrorDetails(err);
        failedAsExpected = details.pgCode === '42601' || details.message.toLowerCase().includes('syntax error in tsquery');
        capturedError = `prismaCode=${details.code}, pgSqlState=${details.pgCode}, message=${details.message}`;
      }
      log(`[BROKEN to_tsquery] ${failedAsExpected ? 'FAILED' : 'UNEXPECTED_PASS'} -> ${capturedError}`);
      assertCheck(
        failedAsExpected,
        `to_tsquery() fails with syntax error (SQLSTATE 42601) on ${JSON.stringify(tc.input)}`,
        capturedError,
      );

      // 2. Safe plainto_tsquery() with parameterized SQL ($1, $2)
      const parsedRows = await prisma.$queryRawUnsafe<Array<{ parsed: string }>>(
        `SELECT plainto_tsquery('english', $1)::text AS parsed`,
        tc.input,
      );
      const safeRows = await prisma.$queryRawUnsafe<SearchRow[]>(
        PLAINTO_TSQUERY_SAFE_SQL,
        ownerId,
        tc.input,
      );
      const parsedTsQuery = parsedRows[0]?.parsed ?? '';
      log(
        `[SAFE plainto_tsquery] OK -> parsed=${JSON.stringify(parsedTsQuery)}, hits=${safeRows.length}, codes=[${safeRows.map((r) => r.code).join(',')}]`,
      );
      assertCheck(
        safeRows.length === tc.expectedSafeHits,
        `plainto_tsquery() safely handles ${JSON.stringify(tc.input)} without syntax error`,
        `parsed=${JSON.stringify(parsedTsQuery)}, hits=${safeRows.length}`,
      );

      // 3. Confirm current production Prisma parameterized ILIKE/contains query also handles the input safely
      const prodRows = await prisma.link.findMany({
        where: {
          createdBy: ownerId,
          OR: [
            { longUrl: { contains: tc.input, mode: 'insensitive' } },
            { code: { contains: tc.input, mode: 'insensitive' } },
          ],
        },
        select: { id: true, code: true },
      });
      log(
        `[PROD Prisma contains/ILIKE] OK -> hits=${prodRows.length} (no SQL/tsquery syntax error)`,
      );
      assertCheck(
        Array.isArray(prodRows),
        `Production Prisma parameterized contains handles ${JSON.stringify(tc.input)} safely`,
        `hits=${prodRows.length}`,
      );
      log('');
    }
  } finally {
    await prisma.link.deleteMany({ where: { createdBy: ownerId } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  log('====================================================================');
  log(`SUMMARY: passed=${passed}, failed=${failures.length}`);
  log('====================================================================');
  log(`Evidence saved to: ${outFile}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Fatal error running Module 08 break reproduction:', err);
  process.exit(1);
});
