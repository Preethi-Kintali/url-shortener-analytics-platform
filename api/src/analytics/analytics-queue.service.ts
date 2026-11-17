import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { redactSensitiveText } from '../common/logging/redaction.util';
import { StructuredLoggerService } from '../common/logging/structured-logger.service';
import { getRedisConfig } from '../config/validate-env';
import {
  ANALYTICS_QUEUE_NAME,
  CLICK_JOB_ATTEMPTS,
  CLICK_JOB_BACKOFF_MS,
  ClickEventJobPayload,
  PURGE_EXPIRED_CLICKS_JOB_NAME,
  QUEUE_ENQUEUE_TIMEOUT_MS,
  RECORD_CLICK_JOB_NAME,
  RETENTION_REPEAT_INTERVAL_MS,
} from './analytics.constants';

const REDIS_CONNECT_TIMEOUT_MS = 500;
const REDIS_COMMAND_TIMEOUT_MS = 500;
const REDIS_ERROR_LOG_COOLDOWN_MS = 30_000;

@Injectable()
export class AnalyticsQueueService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;
  private queue: Queue | null = null;
  private shuttingDown = false;
  private lastErrorLogMs = 0;

  constructor(private readonly logger: StructuredLoggerService) {
    const config = getRedisConfig();
    if (!config.redisUrl) {
      this.logger.warn(
        {
          event: 'analytics_queue_config_invalid',
          status: 'degraded',
          reason: config.invalidReason || 'Redis disabled',
        },
        'AnalyticsQueueService',
      );
      return;
    }

    const client = new Redis(config.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => {
        if (this.shuttingDown) {
          return null;
        }
        return Math.min(times * 250, 3000);
      },
    });

    client.on('ready', () => {
      this.lastErrorLogMs = 0;
      this.logger.log({ event: 'analytics_queue_redis_ready', status: 'ok' }, 'AnalyticsQueueService');
    });

    client.on('error', (err: Error) => {
      this.logErrorThrottled('analytics_queue_redis_error', err);
    });

    const queue = new Queue(ANALYTICS_QUEUE_NAME, {
      connection: client as unknown as NonNullable<ConstructorParameters<typeof Queue>[1]>['connection'],
      defaultJobOptions: {
        attempts: CLICK_JOB_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: CLICK_JOB_BACKOFF_MS,
        },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });

    queue.on('error', (err: Error) => {
      this.logErrorThrottled('analytics_queue_error', err);
    });

    this.client = client;
    this.queue = queue;
  }

  async onModuleInit(): Promise<void> {
    if (!this.client || this.client.status !== 'wait') {
      return;
    }

    try {
      await this.client.connect();
    } catch (err) {
      this.logger.warn(
        {
          event: 'analytics_queue_connect_failed',
          status: 'degraded',
          reason: this.toSafeReason(err),
        },
        'AnalyticsQueueService',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;

    if (this.queue) {
      try {
        await this.queue.close();
      } catch {
        // Ignore shutdown errors
      }
      this.queue = null;
    }

    if (this.client) {
      try {
        this.client.disconnect(false);
      } catch {
        // Ignore cleanup errors
      }
      this.client = null;
    }
  }

  async enqueueClickEvent(payload: ClickEventJobPayload): Promise<boolean> {
    if (!this.queue || !this.client || this.client.status !== 'ready') {
      this.logger.warn(
        {
          event: 'click_enqueue_fallback',
          layer: 'bullmq',
          code: payload.code,
          idempotency_key: payload.eventId,
          reason: this.client ? `redis_status_${this.client.status}` : 'queue_disabled',
        },
        'AnalyticsQueueService',
      );
      return false;
    }

    let timer: NodeJS.Timeout | undefined;
    try {
      const enqueuePromise = this.queue.add(RECORD_CLICK_JOB_NAME, payload, {
        jobId: payload.eventId,
      });
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('enqueue_timeout')), QUEUE_ENQUEUE_TIMEOUT_MS);
      });

      await Promise.race([enqueuePromise, timeoutPromise]);
      this.logger.log(
        {
          event: 'click_event_enqueued',
          layer: 'bullmq',
          code: payload.code,
          idempotency_key: payload.eventId,
        },
        'AnalyticsQueueService',
      );
      return true;
    } catch (err) {
      this.logger.warn(
        {
          event: 'click_enqueue_fallback',
          layer: 'bullmq',
          code: payload.code,
          idempotency_key: payload.eventId,
          reason: this.toSafeReason(err),
        },
        'AnalyticsQueueService',
      );
      return false;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async ensureRetentionScheduler(): Promise<void> {
    if (!this.queue || !this.client || this.client.status !== 'ready') {
      return;
    }

    try {
      await this.queue.upsertJobScheduler(
        'analytics-retention-daily',
        { every: RETENTION_REPEAT_INTERVAL_MS },
        {
          name: PURGE_EXPIRED_CLICKS_JOB_NAME,
          data: {},
        },
      );
      this.logger.log(
        {
          event: 'analytics_retention_scheduler_ready',
          interval_ms: RETENTION_REPEAT_INTERVAL_MS,
        },
        'AnalyticsQueueService',
      );
    } catch (err) {
      this.logger.warn(
        {
          event: 'analytics_retention_scheduler_failed',
          reason: this.toSafeReason(err),
        },
        'AnalyticsQueueService',
      );
    }
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
          reason: this.toSafeReason(err),
        },
        'AnalyticsQueueService',
      );
    }
  }

  private toSafeReason(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err ?? 'unknown_error');
    return redactSensitiveText(raw).slice(0, 200);
  }
}

