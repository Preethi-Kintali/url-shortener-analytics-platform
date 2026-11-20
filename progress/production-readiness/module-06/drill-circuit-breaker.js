const path = require('path');

// Dynamically require compiled dist files
const { CircuitBreakerService } = require('D:/Knack labs/api/dist/common/resilience/circuit-breaker.service');
const { retryWithBackoff } = require('D:/Knack labs/api/dist/common/resilience/retry-backoff.util');

async function runDrill() {
  console.log('================================================================================');
  console.log('MODULE 06: RESILIENCE & CIRCUIT BREAKER FAILURE-FIRST DRILL');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('================================================================================\n');

  const logs = [];
  const mockLogger = {
    log: (obj, context) => {
      const entry = { level: 'INFO', timestamp: new Date().toISOString(), context, ...obj };
      logs.push(entry);
      console.log(`[LOGGER-INFO]`, JSON.stringify(entry));
    },
    error: (obj, context) => {
      const entry = { level: 'ERROR', timestamp: new Date().toISOString(), context, ...obj };
      logs.push(entry);
      console.log(`[LOGGER-ERROR]`, JSON.stringify(entry));
    },
    warn: (obj, context) => {
      const entry = { level: 'WARN', timestamp: new Date().toISOString(), context, ...obj };
      logs.push(entry);
      console.log(`[LOGGER-WARN]`, JSON.stringify(entry));
    },
  };

  // --------------------------------------------------------------------------
  // TEST 1: RETRY WITH EXPONENTIAL BACKOFF AND JITTER
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: Retry with Exponential Backoff and Jitter ---');
  let attemptCount = 0;
  const failingThenSucceedingOp = async () => {
    attemptCount++;
    if (attemptCount < 3) {
      const err = new Error('Connection reset by peer');
      err.code = 'ECONNRESET';
      throw err;
    }
    return { ok: true, attempts: attemptCount };
  };

  const retryStart = Date.now();
  const retryResult = await retryWithBackoff(failingThenSucceedingOp, {
    maxRetries: 3,
    baseDelay: 50,
    maxDelay: 500,
    jitter: 20,
    logger: mockLogger,
    dependency: 'redis',
    operation: 'ping',
  });
  const retryDuration = Date.now() - retryStart;

  console.log(`Retry succeeded after ${retryDuration}ms on attempt ${retryResult.attempts}`);
  if (retryResult.attempts !== 3) {
    throw new Error(`Expected 3 attempts, got ${retryResult.attempts}`);
  }
  const retryLogs = logs.filter((l) => l.event === 'retry_attempt');
  console.log(`Captured ${retryLogs.length} retry_attempt logs. [PASS]\n`);

  // --------------------------------------------------------------------------
  // TEST 2: EXPLICIT TIMEOUT WITH ABORT CONTROLLER
  // --------------------------------------------------------------------------
  console.log('--- TEST 2: Explicit Timeouts on External Calls ---');
  const breakerService = new CircuitBreakerService(mockLogger);

  let timedOutError = null;
  const timeoutStart = Date.now();
  try {
    await breakerService.executeWithTimeout(
      'database',
      'findUniqueLink',
      async (signal) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve('should-not-resolve'), 2000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const err = new Error('Operation aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      },
      300, // 300ms explicit timeout
    );
  } catch (err) {
    timedOutError = err;
  }
  const timeoutElapsed = Date.now() - timeoutStart;
  console.log(`Timeout triggered in ${timeoutElapsed}ms (target 300ms):`, timedOutError?.message);
  if (!timedOutError || timeoutElapsed > 600) {
    throw new Error('Explicit timeout failed to trigger promptly');
  }
  const timeoutLogs = logs.filter((l) => l.event === 'dependency_timeout');
  console.log(`Captured ${timeoutLogs.length} dependency_timeout log(s). [PASS]\n`);

  // --------------------------------------------------------------------------
  // TEST 3: CIRCUIT BREAKER LIFECYCLE (CLOSED -> OPEN -> FALLBACK -> HALF-OPEN -> CLOSED)
  // --------------------------------------------------------------------------
  console.log('--- TEST 3: Circuit Breaker Lifecycle Drill ---');
  let dbHealthy = false;
  let dbCallCount = 0;

  const simulateDatabaseQuery = async (code) => {
    dbCallCount++;
    if (!dbHealthy) {
      // Simulate slow / failing database
      await new Promise((r) => setTimeout(r, 200));
      const err = new Error(`Connection refused: database down on port 5432`);
      err.code = 'ECONNREFUSED';
      throw err;
    }
    return { code, longUrl: 'https://example.com/target', status: 'live' };
  };

  const fallbackHandler = (code) => {
    return { code, longUrl: 'https://status.myservice.internal/degraded', source: 'circuit_open_fallback' };
  };

  const testBreaker = breakerService.getBreaker(
    'test_db',
    simulateDatabaseQuery,
    fallbackHandler,
    {
      timeout: 500, // 500ms timeout
      errorThresholdPercentage: 50,
      resetTimeout: 1500, // 1.5s recovery timeout for quick half-open test
      volumeThreshold: 5, // Open after 5 requests
    },
  );

  console.log('Phase 1: DB is DOWN. Sending 5 initial requests to trip breaker...');
  for (let i = 1; i <= 5; i++) {
    try {
      await testBreaker.fire('link_' + i);
    } catch (err) {
      // expected failure
    }
  }

  console.log(`Circuit state after 5 failures: ${testBreaker.opened ? 'OPEN' : 'CLOSED'}`);
  if (!testBreaker.opened) {
    throw new Error('Circuit breaker failed to trip open after 5 failures');
  }

  console.log('\nPhase 2: Circuit is OPEN. Sending 5 subsequent requests (expect immediate fallback < 50ms)...');
  const dbCallsBeforeOpen = dbCallCount;
  for (let i = 6; i <= 10; i++) {
    const t0 = Date.now();
    const result = await testBreaker.fire('link_' + i);
    const latency = Date.now() - t0;
    console.log(`Request ${i}: returned fallback in ${latency}ms (source: ${result.source})`);
    if (latency > 100) {
      throw new Error(`Fallback response took too long: ${latency}ms`);
    }
    if (result.source !== 'circuit_open_fallback') {
      throw new Error(`Expected fallback response, got: ${JSON.stringify(result)}`);
    }
  }

  // Ensure NO database calls were attempted while circuit was OPEN
  const dbCallsDuringOpen = dbCallCount - dbCallsBeforeOpen;
  console.log(`Database calls made while circuit was OPEN: ${dbCallsDuringOpen} (MUST BE 0)`);
  if (dbCallsDuringOpen !== 0) {
    throw new Error(`Database was contacted while circuit breaker was OPEN!`);
  }

  console.log('\nPhase 3: Restoring database and awaiting reset timeout (1500ms)...');
  dbHealthy = true;
  await new Promise((r) => setTimeout(r, 1600));

  console.log('Phase 4: Sending trial request in HALF-OPEN state...');
  const recoveryResult = await testBreaker.fire('recovered_link');
  console.log('Recovery result:', recoveryResult);

  console.log(`Circuit state after successful probe: ${testBreaker.closed ? 'CLOSED' : 'OPEN'}`);
  if (!testBreaker.closed) {
    throw new Error('Circuit failed to close after successful half-open trial');
  }

  // --------------------------------------------------------------------------
  // SUMMARY OF EVENT TELEMETRY
  // --------------------------------------------------------------------------
  console.log('\n================================================================================');
  console.log('TELEMETRY VERIFICATION SUMMARY');
  console.log('================================================================================');
  const eventCounts = {};
  for (const l of logs) {
    if (l.event) {
      eventCounts[l.event] = (eventCounts[l.event] || 0) + 1;
    }
  }
  console.log('Event frequencies captured:');
  console.table(eventCounts);

  const requiredEvents = [
    'retry_attempt',
    'dependency_timeout',
    'circuit_opened',
    'circuit_open_fallback',
    'circuit_half_open',
    'circuit_closed',
  ];

  for (const ev of requiredEvents) {
    if (!eventCounts[ev] || eventCounts[ev] < 1) {
      throw new Error(`Mandatory event '${ev}' was not observed!`);
    }
    console.log(`[VERIFIED] Event '${ev}' emitted (${eventCounts[ev]} times)`);
  }

  console.log('\nAll resilience patterns verified successfully!');
  breakerService.onModuleDestroy();
}

runDrill().catch((err) => {
  console.error('DRILL FAILED:', err);
  process.exit(1);
});
