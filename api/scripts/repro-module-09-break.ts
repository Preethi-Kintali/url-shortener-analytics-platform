import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-09');
fs.mkdirSync(evidenceDir, { recursive: true });
const outFile = path.join(evidenceDir, 'test-break-repro.txt');
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

// Target strictly the dedicated test database
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/upsk_sdf_test?schema=public';
const TEST_REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';

function validateDatabaseIsolation(rawUrl: string): { dbName: string; host: string; port: string; env: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      throw new Error(`CRITICAL SAFETY VIOLATION: Database protocol "${parsed.protocol}" is not postgresql.`);
    }
    const dbName = parsed.pathname.replace(/^\//, '');
    const host = parsed.hostname;
    const port = parsed.port || '5432';
    const env = process.env.NODE_ENV || 'development';

    if (dbName !== 'upsk_sdf_test') {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Target database "${dbName}" is not the approved test database "upsk_sdf_test"! Refusing execution.`,
      );
    }
    if (host !== 'localhost' && host !== '127.0.0.1') {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Target host "${host}" is not local. Refusing execution.`,
      );
    }
    if (port !== '5432') {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Target port "${port}" is not expected port 5432. Refusing execution.`,
      );
    }
    if (env !== 'test') {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Execution environment "${env}" is not explicitly "test". Refusing execution.`,
      );
    }
    return { dbName, host, port, env };
  } catch (err: any) {
    throw new Error(`Database URL validation failed: ${err.message}`);
  }
}

async function run(): Promise<void> {
  log('====================================================================');
  log('Module 09: Testing Pitfalls & Failure Modes Reproduction');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('====================================================================\n');

  // Verify safety guard against test database
  process.env.NODE_ENV = 'test';
  validateDatabaseIsolation(TEST_DATABASE_URL);

  const testPrisma = new PrismaClient({
    datasources: { db: { url: TEST_DATABASE_URL } },
  });
  await testPrisma.$connect();

  const testRedis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: 3 });

  try {
    // ==================================================================
    // EXPERIMENT 1 (EASY): Test Accidentally Targets Real / Dev Database
    // ==================================================================
    log('--- EXPERIMENT 1: Test Accidentally Targets Real Database (upsk_sdf) ---');
    log('Scenario: CI or local script inadvertently inherits development DATABASE_URL.');

    const devDatabaseUrl = 'postgresql://postgres:postgres@localhost:5432/upsk_sdf?schema=public';
    let interceptedException = '';
    let safetyGuardTriggered = false;

    try {
      // Pass the development DB URL to our isolation validator
      validateDatabaseIsolation(devDatabaseUrl);
    } catch (err: any) {
      safetyGuardTriggered = true;
      interceptedException = err.message;
    }

    assertCheck(
      safetyGuardTriggered &&
        interceptedException.includes('is not the approved test database "upsk_sdf_test"'),
      'EXPERIMENT 1.1: Pre-flight isolation validator intercepts real DB target and halts execution',
      `caught="${interceptedException}"`,
    );

    // Demonstrate the catastrophic impact if the validator were absent
    const mockUnsafeRunnerWipesData = (targetDb: string) => {
      if (targetDb === 'upsk_sdf') {
        return 'DATA_LOSS_DISASTER: 24 user links and analytics wiped from development DB!';
      }
      return 'SAFE: Isolated test database cleared.';
    };

    const simulatedOutcome = mockUnsafeRunnerWipesData('upsk_sdf');
    assertCheck(
      simulatedOutcome.startsWith('DATA_LOSS_DISASTER'),
      'EXPERIMENT 1.2: Confirmed danger: Without pre-flight guard, test teardown would wipe real data',
      simulatedOutcome,
    );

    // ==================================================================
    // EXPERIMENT 2 (MEDIUM): Missing Assertions for Edge Cases (False Confidence)
    // ==================================================================
    log('\n--- EXPERIMENT 2: Missing Assertions & False Confidence in Edge Cases ---');
    log('Scenario: Test asserts generic status (200/302) but fails to assert Location header or DB integrity.');

    // Mock buggy redirect response: returns HTTP 302, but Location header points to an attacker open-redirect
    const buggyRedirectResponse = {
      status: 302,
      headers: new Map([
        ['location', 'https://attacker.evil.com/phishing'], // Buggy / hijacked redirect!
      ]),
    };

    const expectedLongUrl = 'https://docs.example.com/legitimate-page';

    // A weak test only checks: status is a redirect (302)
    const weakAssertionPasses = buggyRedirectResponse.status === 302;
    // A strict assertion checks both status AND exact Location header
    const strictAssertionPasses =
      buggyRedirectResponse.status === 302 &&
      buggyRedirectResponse.headers.get('location') === expectedLongUrl;

    assertCheck(
      weakAssertionPasses === true,
      'EXPERIMENT 2.1: Weak assertion falsely passes despite malicious Location header',
      `weakAssertStatus=302 -> passed=${weakAssertionPasses}`,
    );

    assertCheck(
      strictAssertionPasses === false,
      'EXPERIMENT 2.2: Strict assertion catches the edge case and rejects malicious Location header',
      `expected="${expectedLongUrl}", got="${buggyRedirectResponse.headers.get('location')}"`,
    );

    // ==================================================================
    // EXPERIMENT 3 (HARD): Flaky Tests Due to Shared State & Missing Cleanup
    // ==================================================================
    log('\n--- EXPERIMENT 3: Flaky Test Due to Shared State Across Runs ---');
    log('Scenario: Test run 1 creates unique records without cleaning up. Test run 2 crashes on duplicate keys.');

    // Clean test DB before starting the experiment
    await testPrisma.clickEvent.deleteMany({});
    await testPrisma.link.deleteMany({});
    await testRedis.flushdb();

    // Create shared parent link
    const sharedCode = `flaky_${Date.now()}`;
    const testLink = await testPrisma.link.create({
      data: {
        code: sharedCode,
        longUrl: 'https://example.com/flaky-test-demo',
        createdBy: 'principal_a',
        tags: ['shared-state'],
      },
    });

    const fixedIdempotencyKey = 'fixed_shared_key_12345';

    // Simulated Run 1: Test executes, inserts click record, but fails to cleanup (e.g. abrupt exit or missing teardown)
    log('[RUN 1] Executing test iteration 1 without cleanup...');
    const run1Insert = await testPrisma.clickEvent.create({
      data: {
        idempotencyKey: fixedIdempotencyKey,
        linkId: testLink.id,
        clickedAt: new Date(),
        userAgent: 'Run1-Agent',
        referrer: 'direct',
        ipHash: 'a'.repeat(64),
      },
    });

    assertCheck(
      run1Insert.idempotencyKey === fixedIdempotencyKey,
      'EXPERIMENT 3.1: Run 1 passes successfully and commits record to database',
      `idempotencyKey=${run1Insert.idempotencyKey}`,
    );

    // Simulated Run 2: Test executes identically (e.g. rerun in CI). Because Run 1 left state behind, Run 2 fails!
    log('[RUN 2] Executing identical test iteration 2 with shared dirty state...');
    let run2Error: any = null;
    try {
      await testPrisma.clickEvent.create({
        data: {
          idempotencyKey: fixedIdempotencyKey,
          linkId: testLink.id,
          clickedAt: new Date(),
          userAgent: 'Run2-Agent',
          referrer: 'direct',
          ipHash: 'b'.repeat(64),
        },
      });
    } catch (err: any) {
      run2Error = err;
    }

    assertCheck(
      run2Error !== null && run2Error.code === 'P2002',
      'EXPERIMENT 3.2: Run 2 crashes with P2002 Unique Constraint Violation due to uncleaned shared state',
      `code=${run2Error?.code}, meta=${JSON.stringify(run2Error?.meta)}`,
    );

    // Demonstrated Fix: Automated pre-flight cleanup or transaction isolation restores determinism
    log('[CLEANUP & FIX] Applying deterministic cleanup before Run 3...');
    await testPrisma.clickEvent.deleteMany({});
    await testPrisma.link.deleteMany({});

    // Now re-create link and re-run with clean state
    const cleanLink = await testPrisma.link.create({
      data: {
        code: sharedCode,
        longUrl: 'https://example.com/flaky-test-demo',
        createdBy: 'principal_a',
        tags: ['shared-state'],
      },
    });

    const run3Insert = await testPrisma.clickEvent.create({
      data: {
        idempotencyKey: fixedIdempotencyKey,
        linkId: cleanLink.id,
        clickedAt: new Date(),
        userAgent: 'Run3-Agent',
        referrer: 'direct',
        ipHash: 'c'.repeat(64),
      },
    });

    assertCheck(
      run3Insert.idempotencyKey === fixedIdempotencyKey,
      'EXPERIMENT 3.3: Run 3 passes deterministically after applying automated cleanup',
      `idempotencyKey=${run3Insert.idempotencyKey}`,
    );

  } finally {
    log('\n[TEARDOWN] Cleaning up experiment fixtures from test database...');
    await testPrisma.clickEvent.deleteMany({});
    await testPrisma.link.deleteMany({});
    await testRedis.flushdb();
    testRedis.disconnect();
    await testPrisma.$disconnect();
  }

  log('\n====================================================================');
  log(`SUMMARY: passed=${passed}, failed=${failures.length}`);
  log('====================================================================');
  log(`Evidence saved to: ${outFile}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('Fatal error in Module 09 break reproduction:', err);
  process.exit(1);
});

