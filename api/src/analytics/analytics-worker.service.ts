import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';
import { redactSensitiveText } from '../common/logging/redaction.util';
import { StructuredLoggerService } from '../common/logging/structured-logger.service';
import { generateRequestId, isValidRequestId, runWithRequestId } from '../common/middleware/request-id.util';
import { getRedisConfig } from '../config/validate-env';
import {
  ANALYTICS_QUEUE_NAME,
  CLICK_JOB_ATTEMPTS,
  ClickEventJobPayload,
  PURGE_EXPIRED_CLICKS_JOB_NAME,
  RECORD_CLICK_JOB_NAME,
} from './analytics.constants';
import { AnalyticsQueueService } from './analytics-queue.service';
import { AnalyticsService } from './analytics.service';

const REDIS_CONNECT_TIMEOUT_MS = 2000;
const REDIS_ERROR_LOG_COOLDOWN_MS = 30_000;

@Injectable()
export class AnalyticsWorkerService implements OnModuleInit, OnModuleDestroy {
  private redisClient: Redis | null = null;
  private worker: Worker | null = null;
  private shuttingDown = false;
  private lastErrorLogMs = 0;

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly analyticsQueueService: AnalyticsQueueService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const config = getRedisConfig();
    if (!config.redisUrl) {
      this.logger.warn(
        {
          event: 'worker_redis_config_invalid',
          status: 'degraded',
          reason: config.invalidReason || 'Redis disabled',
        },
        'AnalyticsWorkerService',
      );
      return;
    }

    // BullMQ Worker requires maxRetriesPerRequest: null for blocking commands.
    const redisClient = new Redis(config.redisUrl, {
      lazyConnect: true,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => {
        if (this.shuttingDown) {
          return null;
        }
        return Math.min(times * 250, 3000);
      },
    });

    redisClient.on('ready', () => {
      this.lastErrorLogMs = 0;
      this.logger.log({ event: 'worker_redis_ready', status: 'ok' }, 'AnalyticsWorkerService');
    });

    redisClient.on('error', (err: Error) => {
      this.logErrorThrottled('worker_redis_error', err);
    });

    const worker = new Worker(
      ANALYTICS_QUEUE_NAME,
      async (job: Job) => this.processJob(job),
      {
        connection: redisClient as unknown as NonNullable<ConstructorParameters<typeof Worker>[2]>['connection'],
        concurrency: 5,
      },
    );

    worker.on('failed', (job: Job | undefined, err: Error) => {
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? CLICK_JOB_ATTEMPTS;
      const isPermanent = err instanceof UnrecoverableError || attemptsMade >= maxAttempts;
      const event = isPermanent ? 'click_job_failed_permanent' : 'click_job_retry_scheduled';
      const payloadData = (job?.data ?? {}) as Partial<ClickEventJobPayload>;

      const logPayload = {
        event,
        queue: ANALYTICS_QUEUE_NAME,
        job_id: job?.id,
        job_name: job?.name,
        code: payloadData.code,
        idempotency_key: payloadData.eventId,
        attempt: attemptsMade,
        max_attempts: maxAttempts,
        reason: redactSensitiveText(err.message).slice(0, 200),
      };

      const requestId =
        payloadData.requestId && isValidRequestId(payloadData.requestId)
          ? payloadData.requestId
          : undefined;

      const emit = () => {
        if (isPermanent) {
          this.logger.error(logPayload, undefined, 'AnalyticsWorkerService');
        } else {
          this.logger.warn(logPayload, 'AnalyticsWorkerService');
        }
      };

      if (requestId) {
        runWithRequestId(requestId, emit);
      } else {
        emit();
      }
    });

    worker.on('error', (err: Error) => {
      this.logErrorThrottled('worker_error', err);
    });

    this.redisClient = redisClient;
    this.worker = worker;

    try {
      await this.analyticsQueueService.ensureRetentionScheduler();
    } catch {
      // Non-fatal: worker continues listening for jobs
    }

    this.logger.log(
      {
        event: 'worker_started',
        queue: ANALYTICS_QUEUE_NAME,
        concurrency: 5,
      },
      'AnalyticsWorkerService',
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    this.logger.log({ event: 'worker_stopping', queue: ANALYTICS_QUEUE_NAME }, 'AnalyticsWorkerService');

    if (this.worker) {
      try {
        await this.worker.close();
      } catch {
        // Ignore cleanup errors
      }
      this.worker = null;
    }

    if (this.redisClient) {
      try {
        this.redisClient.disconnect(false);
      } catch {
        // Ignore cleanup errors
      }
      this.redisClient = null;
    }

    this.logger.log({ event: 'worker_stopped', queue: ANALYTICS_QUEUE_NAME }, 'AnalyticsWorkerService');
  }

  async processJob(job: Job): Promise<unknown> {
    if (job.name === PURGE_EXPIRED_CLICKS_JOB_NAME) {
      return this.analyticsService.purgeExpiredClickEvents();
    }

    if (job.name !== RECORD_CLICK_JOB_NAME) {
      throw new UnrecoverableError(`Unsupported analytics job name: ${job.name}`);
    }

    const payload = job.data as ClickEventJobPayload;
    if (!payload || typeof payload.eventId !== 'string' || typeof payload.code !== 'string') {
      throw new UnrecoverableError('Malformed click event job payload');
    }

    const traceId =
      payload.requestId && isValidRequestId(payload.requestId)
        ? payload.requestId
        : generateRequestId();

    return runWithRequestId(traceId, async () => {
      this.logger.log(
        {
          event: 'click_job_processing',
          queue: ANALYTICS_QUEUE_NAME,
          job_id: job.id,
          code: payload.code,
          idempotency_key: payload.eventId,
          attempt: job.attemptsMade + 1,
          max_attempts: job.opts?.attempts ?? CLICK_JOB_ATTEMPTS,
        },
        'AnalyticsWorkerService',
      );

      let result;
      try {
        result = await this.analyticsService.persistClickEvent(payload);
      } catch (err) {
        if (err instanceof BadRequestException) {
          throw new UnrecoverableError(err.message);
        }
        throw err;
      }

      if (result.status === 'persisted') {
        this.logger.log(
          {
            event: 'click_job_persisted',
            queue: ANALYTICS_QUEUE_NAME,
            job_id: job.id,
            code: payload.code,
            link_id: result.linkId,
            idempotency_key: result.idempotencyKey,
          },
          'AnalyticsWorkerService',
        );
      } else if (result.status === 'duplicate_ignored') {
        this.logger.log(
          {
            event: 'click_job_duplicate_ignored',
            queue: ANALYTICS_QUEUE_NAME,
            job_id: job.id,
            code: payload.code,
            link_id: result.linkId,
            idempotency_key: result.idempotencyKey,
          },
          'AnalyticsWorkerService',
        );
      } else {
        this.logger.warn(
          {
            event: 'click_job_skipped_missing_link',
            queue: ANALYTICS_QUEUE_NAME,
            job_id: job.id,
            code: payload.code,
            idempotency_key: result.idempotencyKey,
          },
          'AnalyticsWorkerService',
        );
      }

      return result;
    });
  }

  private logErrorThrottled(event: string, err: Error): void {
    if (this.shuttingDown) {
      return;
    }
    const now = Date.now();
    if (now - this.lastErrorLogMs >= REDIS_ERROR_LOG_COOLDOWN_MS) {
      this.lastErrorLogMs = now;
      this.logger.warn(
        {
          event,
          status: 'degraded',
          reason: redactSensitiveText(err.message).slice(0, 200),
        },
        'AnalyticsWorkerService',
      );
    }
  }
}
