import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  const testCode = 'm2-test-' + Math.floor(Math.random() * 100000);
  const testUrl = 'https://example.com/dest-' + testCode;

  console.log(`[SEED] Inserting link: code=${testCode}, url=${testUrl}`);
  const createdLink = await prisma.link.create({
    data: {
      code: testCode,
      longUrl: testUrl,
      createdBy: 'test-user-seed',
      clicks: {
        create: [
          {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            referrer: 'https://google.com',
            ipHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          },
        ],
      },
    },
    include: {
      clicks: true,
    },
  });

  console.log(`[QUERY] Selecting link by code: ${testCode}`);
  const foundLink = await prisma.link.findUnique({
    where: { code: testCode },
    include: { clicks: true },
  });

  if (!foundLink) {
    throw new Error(`Link not found for code: ${testCode}`);
  }

  console.log(`[RESULT] inserted code: ${createdLink.code}`);
  console.log(`[RESULT] selected code: ${foundLink.code}`);
  console.log(`[RESULT] matched long_url: ${foundLink.longUrl}`);
  console.log(`[RESULT] associated clicks count: ${foundLink.clicks.length}`);

  // Test duplicate short-code rejection
  console.log(`[DUPLICATE TEST] Attempting to insert duplicate code=${testCode}`);
  try {
    await prisma.link.create({
      data: {
        code: testCode,
        longUrl: 'https://another-destination.com',
        createdBy: 'duplicate-tester',
      },
    });
    throw new Error('FAILED: Duplicate code insertion should have thrown UniqueConstraintError!');
  } catch (err: any) {
    if (err.code === 'P2002') {
      console.log(`[DUPLICATE TEST PASSED] Unique constraint properly rejected duplicate code (Prisma error P2002).`);
    } else {
      throw err;
    }
  }
}

main()
  .catch((e) => {
    console.error('[ERROR]', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
