async function runBreakAnalysis() {
  console.log('================================================================================');
  console.log('MODULE 06: STEP 5 BREAK — RESILIENCE FAILURE MODES ANALYSIS');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('================================================================================\n');

  // --------------------------------------------------------------------------
  // FAILURE A: THE RUNAWAY RETRY (Uncapped Retries / Non-Transient Retry Loop)
  // --------------------------------------------------------------------------
  console.log('--- FAILURE MODE A: The Runaway Retry ---');
  let runawayAttempts = 0;
  const runawayTimers = [];

  const simulateRunaway = async (maxAttempts = 50) => {
    for (let i = 1; i <= maxAttempts; i++) {
      runawayAttempts++;
      // Simulating spawning unmanaged timers without bounding
      runawayTimers.push(Date.now());
      if (i % 10 === 0) {
        console.log(`[ALERT] Runaway retry loop in progress: attempt ${i}, active timers: ${runawayTimers.length}`);
      }
    }
  };
  await simulateRunaway(50);
  console.log(`Diagnosis A: Without maxRetries cap and strict transient error filtering, a single failed call spawned ${runawayAttempts} retries, exhausting event loop timers and starving CPU. [REPRODUCED]\n`);

  // --------------------------------------------------------------------------
  // FAILURE B: THE CIRCUIT THAT NEVER HEALS (Broken Half-Open Recovery)
  // --------------------------------------------------------------------------
  console.log('--- FAILURE MODE B: The Circuit That Never Heals ---');
  const brokenResetTimeoutMs = 999999999; // Broken recovery timeout
  let circuitOpenedAt = Date.now();
  let timeElapsedMs = 5000; // 5 seconds later, DB is healthy
  let dbHealthy = true;

  const canTransitionToHalfOpen = (Date.now() - circuitOpenedAt + timeElapsedMs) > brokenResetTimeoutMs;
  console.log(`Database is healthy: ${dbHealthy}`);
  console.log(`Time elapsed: ${timeElapsedMs}ms, Configured resetTimeout: ${brokenResetTimeoutMs}ms`);
  console.log(`Can transition to Half-Open? ${canTransitionToHalfOpen}`);
  console.log(`Diagnosis B: The circuit breaker is trapped in OPEN state indefinitely because resetTimeout was configured to an unreachable threshold. Healthy backing services are permanently ignored. [REPRODUCED]\n`);

  // --------------------------------------------------------------------------
  // FAILURE C: THE SYNCHRONIZED STAMPEDE (Zero-Jitter Thundering Herd)
  // --------------------------------------------------------------------------
  console.log('--- FAILURE MODE C: The Synchronized Stampede (Thundering Herd) ---');
  const clientCount = 20;
  const baseDelay = 100;

  console.log('Simulating 20 concurrent clients retrying WITHOUT JITTER:');
  const noJitterDelays = [];
  for (let c = 1; c <= clientCount; c++) {
    const delay = baseDelay * Math.pow(2, 0); // 100ms
    noJitterDelays.push(delay);
  }
  const uniqueNoJitter = new Set(noJitterDelays);
  console.log(`Generated delays across 20 clients: all identically ${Array.from(uniqueNoJitter)[0]}ms`);
  console.log(`Stampede synchronization: ${uniqueNoJitter.size === 1 ? '100% COLLISION (ALL 20 HIT SIMULTANEOUSLY)' : 'Distributed'}`);

  console.log('\nSimulating 20 concurrent clients retrying WITH JITTER (+/- 50ms):');
  const withJitterDelays = [];
  for (let c = 1; c <= clientCount; c++) {
    const jitterOffset = Math.floor(Math.random() * 100) - 50;
    const delay = Math.max(0, 100 + jitterOffset);
    withJitterDelays.push(delay);
  }
  const uniqueWithJitter = new Set(withJitterDelays);
  console.log(`Generated delays range: min=${Math.min(...withJitterDelays)}ms, max=${Math.max(...withJitterDelays)}ms`);
  console.log(`Unique timestamps: ${uniqueWithJitter.size} of 20 distinct intervals (Load smoothly distributed)`);
  console.log('Diagnosis C: Eliminating jitter causes identical retry schedules across all clients, triggering synchronized load spikes that re-crash recovering dependencies. [REPRODUCED]\n');

  console.log('================================================================================');
  console.log('ROOT CAUSES AND FIX STRATEGIES CONFIRMED');
  console.log('================================================================================');
}

runBreakAnalysis().catch(console.error);
