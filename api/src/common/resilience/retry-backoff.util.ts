import { StructuredLoggerService } from '../logging/structured-logger.service';

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  jitter?: number;
  retryableErrors?: string[];
  logger?: StructuredLoggerService;
  dependency?: string;
  operation?: string;
}

const DEFAULT_RETRYABLE_ERRORS = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'P1001', // Prisma: Can't reach database server
  'P1002', // Prisma: Database server was reached but timed out
  'P1008', // Prisma: Operations timed out
];

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 100, // 100ms
    maxDelay = 2000, // Cap at 2000ms
    jitter = 50, // +/- 50ms randomness
    retryableErrors = DEFAULT_RETRYABLE_ERRORS,
    logger,
    dependency = 'unknown',
    operation = 'unknown',
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      const errorCode = error?.code || error?.name || 'UNKNOWN_ERROR';
      const isTransient =
        retryableErrors.includes(errorCode) ||
        error?.message?.toLowerCase().includes('timeout') ||
        error?.message?.toLowerCase().includes('aborted') ||
        error?.message?.toLowerCase().includes('connection closed');

      // Fail fast immediately on non-transient errors (e.g. 400 Bad Request, 401 Unauthorized, 404 Not Found)
      if (!isTransient) {
        throw error;
      }

      // If attempts exhausted, break to rethrow last error
      if (attempt === maxRetries) {
        break;
      }

      // Exponential backoff with full jitter
      const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitterOffset = Math.floor(Math.random() * jitter * 2) - jitter;
      const delay = Math.max(0, exponentialDelay + jitterOffset);

      if (logger) {
        logger.warn(
          {
            event: 'retry_attempt',
            dependency,
            operation,
            attempt: attempt + 1,
            max_retries: maxRetries,
            delay_ms: delay,
            error_code: errorCode,
            error_message: error?.message || 'Operation failed',
          },
          'RetryBackoff',
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
