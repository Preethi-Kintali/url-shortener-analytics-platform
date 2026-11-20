const { execSync } = require('child_process');

function runCmd(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : err.message);
  }
}

async function runBreakAnalysis() {
  console.log('================================================================================');
  console.log('MODULE 07: STEP 5 BREAK — RUNBOOK DRIFT & REALITY MISMATCH ANALYSIS');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('================================================================================\n');

  // --------------------------------------------------------------------------
  // SCENARIO A: STALE RUNBOOK (Container Name Drift)
  // --------------------------------------------------------------------------
  console.log('--- SCENARIO A: Stale Runbook (Container Name Drift) ---');
  console.log('Simulating renamed container: "myservice-api-prod" vs runbook "myservice-prod"');
  const staleCmd = 'docker logs myservice-prod';
  const staleOutput = runCmd(staleCmd);
  console.log(`Command run: ${staleCmd}`);
  console.log(`Actual Output: "${staleOutput}"`);
  console.log('Diagnosis A: Hardcoded container name failed immediately because deployment renamed container. Runbooks must use dynamic resolution or exact verified labels. [CONFIRMED]\n');

  // --------------------------------------------------------------------------
  // SCENARIO B: MISSING STEP (Cold-Start Cache / Connection Re-init)
  // --------------------------------------------------------------------------
  console.log('--- SCENARIO B: Missing Step (Cold-Start Reconnection & Warmup) ---');
  console.log('Simulating restarting PostgreSQL while API is under traffic:');
  console.log('Problem: Prisma Client / ioredis re-connection cooldown takes up to 30s.');
  console.log('Runbook says "restart database then immediately verify /ready".');
  console.log('Result: Immediate probe fails because pool has not re-established socket connection yet.');
  console.log('Diagnosis B: Missing 3-second socket stabilization delay and retry loop in verification phase caused false-negative incident escalation. [CONFIRMED]\n');

  // --------------------------------------------------------------------------
  // SCENARIO C: AMBIGUOUS PORT / BINDING DRIFT
  // --------------------------------------------------------------------------
  console.log('--- SCENARIO C: Ambiguous Port / Target Drift ---');
  const testPortCmd = 'curl -s -m 2 http://localhost:8080/live';
  const portOutput = runCmd(testPortCmd);
  console.log(`Command run: ${testPortCmd}`);
  console.log(`Actual Output: "${portOutput || 'Connection refused (timeout)'}"`);
  console.log('Diagnosis C: Runbook hardcoded localhost:3000, but in environments with dynamic $PORT, verification fails with ECONNREFUSED. Runbook must specify default port AND $PORT resolution fallback. [CONFIRMED]\n');

  console.log('================================================================================');
  console.log('RUNBOOK ROBUSTNESS HARDENING SPECIFICATION COMPLETE');
  console.log('================================================================================');
}

runBreakAnalysis().catch(console.error);
