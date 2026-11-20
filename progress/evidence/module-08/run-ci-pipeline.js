// ============================================================================
// MODULE 08: SHIP IT — CI PIPELINE AUTOMATED TEST RUNNER
// ============================================================================
// Executes all hermetic test suites sequentially, outputs TAP-compliant results,
// and enforces a binary pass/fail gate (exit code 0 or 1).
// ============================================================================

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const testSuites = [
  {
    name: 'Module 08: Hermetic Environment-Independent Integration Suite',
    script: path.join(__dirname, 'test-hermetic-integration.js'),
  },
  {
    name: 'Module 08: Capstone End-to-End Integration Suite',
    script: path.join(__dirname, 'test-end-to-end-integration.js'),
  },
  {
    name: 'Module 08: Production Regression & Permission Boundary Suite',
    script: path.join(__dirname, 'test-team-collaboration-production.js'),
  },
  {
    name: 'Module 07: RBAC & Privilege Escalation Fix Suite',
    script: path.join(__dirname, '../module-07/test-step6-fix.js'),
  },
  {
    name: 'Module 06: Multi-Agent Parallel Integration Suite',
    script: path.join(__dirname, '../module-06/test-step6-regression.js'),
  },
  {
    name: 'Module 05: Real-Time WebSocket Heartbeat & Replay Suite',
    script: path.join(__dirname, '../module-05/test-fix-regressions.js'),
  },
  {
    name: 'Module 04: Zero-Trust IDOR Authorization Suite',
    script: path.join(__dirname, '../module-04/test-invitation-idor-fix.js'),
  },
];

console.log('================================================================================');
console.log('CI AUTOMATED PIPELINE EXECUTION');
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Executing ${testSuites.length} test suites with zero manual intervention`);
console.log('================================================================================\n');

let totalPassedSuites = 0;
let totalFailedSuites = 0;
const results = [];

for (const suite of testSuites) {
  process.stdout.write(`[RUNNING] ${suite.name}... `);
  try {
    const output = execSync(`node "${suite.script}"`, {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Check output for failure signals
    if (output.includes('FAILED') && !output.includes('0 FAILED')) {
      throw new Error('Test suite reported failures');
    }

    console.log('SUCCESS (Green)');
    totalPassedSuites++;
    results.push({ name: suite.name, status: 'PASSED' });
  } catch (err) {
    console.log('FAILED (Red)');
    console.error(`  Error Output: ${err.stderr || err.stdout || err.message}`);
    totalFailedSuites++;
    results.push({ name: suite.name, status: 'FAILED', error: err.message });
  }
}

console.log('\n================================================================================');
console.log('CI PIPELINE GATE SUMMARY');
console.log(`Passed Suites: ${totalPassedSuites} / ${testSuites.length}`);
console.log(`Failed Suites: ${totalFailedSuites} / ${testSuites.length}`);
console.log(`Binary Signal: ${totalFailedSuites === 0 ? 'GREEN (Ship Ready)' : 'RED (Blocked)'}`);
console.log('================================================================================');

const ciLogFile = path.join(__dirname, 'ci-run-output.txt');
fs.writeFileSync(
  ciLogFile,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      passedSuites: totalPassedSuites,
      failedSuites: totalFailedSuites,
      status: totalFailedSuites === 0 ? 'GREEN' : 'RED',
      results,
    },
    null,
    2
  ),
  'utf8'
);

if (totalFailedSuites > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
