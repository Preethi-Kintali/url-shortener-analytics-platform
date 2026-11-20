import { Injectable, OnModuleDestroy } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { getCurrentRequestId } from '../middleware/request-id.util';
import { StructuredLoggerService } from '../logging/structured-logger.service';

export interface BreakerConfigOptions extends CircuitBreaker.Options {
  timeoutMs?: number;
}

@Injectable()
export class CircuitBreakerService implements OnModuleDestroy {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly logger: StructuredLoggerService) {}

  onModuleDestroy() {
    for (const breaker of this.breakers.values()) {
      breaker.shutdown();
    }
    this.breakers.clear();
  }

  getBreaker<T = any, Args extends any[] = any[]>(
    dependency: string,
    action: (...args: Args) => Promise<T>,
    fallbackFn?: (...args: Args) => T | Promise<T>,
    customOptions?: BreakerConfigOptions,
  ): CircuitBreaker<Args, T> {
    if (this.breakers.has(dependency)) {
      return this.breakers.get(dependency) as CircuitBreaker<Args, T>;
    }

    const resetTimeoutEnv = process.env.CIRCUIT_RESET_TIMEOUT_MS
      ? parseInt(process.env.CIRCUIT_RESET_TIMEOUT_MS, 10)
      : 30000;

    const options: CircuitBreaker.Options = {
      timeout: customOptions?.timeout ?? customOptions?.timeoutMs ?? 1000, // 1 second timeout
      errorThresholdPercentage: customOptions?.errorThresholdPercentage ?? 50, // 50% failures trips breaker
      resetTimeout: customOptions?.resetTimeout ?? resetTimeoutEnv, // 30s recovery window (or env)
      volumeThreshold: customOptions?.volumeThreshold ?? 5, // minimum 5 requests before tripping
      allowWarmUp: false,
      ...customOptions,
    };

    const breaker = new CircuitBreaker(action, options);

    breaker.on('open', () => {
      this.logger.error(
        {
          event: 'circuit_opened',
          dependency,
          status: 'open',
          stats: breaker.stats,
        },
        'CircuitBreaker',
      );
    });

    breaker.on('halfOpen', () => {
      this.logger.log(
        {
          event: 'circuit_half_open',
          dependency,
          status: 'half_open',
        },
        'CircuitBreaker',
      );
    });

    breaker.on('close', () => {
      this.logger.log(
        {
          event: 'circuit_closed',
          dependency,
          status: 'closed',
          stats: breaker.stats,
        },
        'CircuitBreaker',
      );
    });

    if (fallbackFn) {
      breaker.fallback((...args: Args) => {
        this.logger.warn(
          {
            event: 'circuit_open_fallback',
            dependency,
            action: action.name || 'anonymous',
          },
          'CircuitBreaker',
        );
        return fallbackFn(...args);
      });
    }

    this.breakers.set(dependency, breaker as CircuitBreaker);
    return breaker as unknown as CircuitBreaker<Args, T>;
  }

  async executeWithTimeout<T>(
    dependency: string,
    operation: string,
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs = 1000,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      this.logger.warn(
        {
          event: 'dependency_timeout',
          dependency,
          operation,
          timeout_ms: timeoutMs,
          request_id: getCurrentRequestId(),
        },
        'CircuitBreaker',
      );
    }, timeoutMs);

    try {
      return await fn(controller.signal);
    } catch (err: any) {
      if (timedOut || err?.name === 'AbortError' || err?.message?.toLowerCase().includes('aborted')) {
        const timeoutError = new Error(`Dependency '${dependency}' timed out after ${timeoutMs}ms`);
        (timeoutError as any).code = 'ETIMEDOUT';
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async execute<T, Args extends any[] = any[]>(
    dependency: string,
    operation: string,
    action: (...args: Args) => Promise<T>,
    fallbackFn?: (...args: Args) => T | Promise<T>,
    options?: BreakerConfigOptions,
    ...args: Args
  ): Promise<T> {
    const breaker = this.getBreaker<T, Args>(dependency, action, fallbackFn, options);
    return breaker.fire(...args);
  }
}
