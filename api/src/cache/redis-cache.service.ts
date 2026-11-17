import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { redactSensitiveText } from '../common/logging/redaction.util';
import { StructuredLoggerService } from '../common/logging/structured-logger.service';
import {
  DEFAULT_REDIRECT_CACHE_TTL_SECONDS,
  getRedisConfig,
  MAX_REDIRECT_CACHE_TTL_SECONDS,
} from '../config/validate-env';

const REDIS_CONNECT_TIMEOUT_MS = 500;
const REDIS_COMMAND_TIMEOUT_MS = 500;
const REDIS_ERROR_LOG_COOLDOWN_MS = 30_000;

export interface CacheMetricsSnapshot {
  hits: number;
  misses: number;
  fallbacks: number;
  invalidations: number;
  invalidationFailures: number;
  status: string;
}

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;
  private defaultTtlSeconds = DEFAULT_REDIRECT_CACHE_TTL_SECONDS;
  private shuttingDown = false;
  private lastErrorLogMs = 0;

  private metrics = {
    hits: 0,
    misses: 0,
    fallbacks: 0,
    invalidations: 0,
    invalidationFailures: 0,
  };

  constructor(private readonly logger: StructuredLoggerService) {
    const config = getRedisConfig();
    this.defaultTtlSeconds = config.redirectTtlSeconds;

    if (!config.redisUrl) {
      this.logger.warn(
        {
          event: 'redis_config_invalid',
          status: 'degraded',
          reason: config.invalidReason || 'Redis disabled',
        },
        'RedisCacheService',
      );
      return;
    }

    const client = new Redis(config.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: 0,
      retryStrategy: (times: number) => {
        if (this.shuttingDown) {
          return null;
        }
        return Math.min(times * 250, 3000);
      },
    });

    client.on('ready', () => {
      this.lastErrorLogMs = 0;
      this.logger.log({ event: 'redis_connected', status: 'ok' }, 'RedisCacheService');
    });

    client.on('error', (err: Error) => {
      if (this.shuttingDown) {
        return;
      }
      const now = Date.now();
      if (now - this.lastErrorLogMs >= REDIS_ERROR_LOG_COOLDOWN_MS) {
        this.lastErrorLogMs = now;
        this.logger.warn(
          {
            event: 'redis_client_error',
            status: 'degraded',
            reason: this.toSafeReason(err),
          },
          'RedisCacheService',
        );
      }
    });

    this.client = client;
  }

  async onModuleInit(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.runWithTimeout(() => this.client!.connect(), REDIS_CONNECT_TIMEOUT_MS + 100);
    } catch (error) {
      this.logger.warn(
        {
          event: 'redis_initial_connect_failed',
          status: 'degraded',
          reason: this.toSafeReason(error),
        },
        'RedisCacheService',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    const client = this.client;
    if (!client) {
      return;
    }

    try {
      if (client.status === 'ready') {
        await this.runWithTimeout(() => client.quit(), 400);
      }
    } catch {
      // Fall back to immediate socket disconnect on shutdown.
    } finally {
      client.disconnect(false);
    }
  }

  getDefaultTtlSeconds(): number {
    return this.defaultTtlSeconds;
  }

  getMetrics(): CacheMetricsSnapshot {
    return {
      ...this.metrics,
      status: this.client?.status ?? 'disabled',
    };
  }

  buildRedirectKey(code: string): string {
    return `redirect:v1:${code}`;
  }

  async getRedirectTarget(code: string): Promise<string | null> {
    const safeCode = this.safeCodeForLog(code);
    const client = this.client;

    if (!client || client.status !== 'ready') {
      this.metrics.fallbacks++;
      this.logger.warn(
        {
          event: 'cache_redis_fallback',
          layer: 'redis',
          operation: 'get',
          code: safeCode,
          reason: client ? `redis_status_${client.status}` : 'redis_disabled',
        },
        'RedisCacheService',
      );
      return null;
    }

    const key = this.buildRedirectKey(code);
    try {
      const target = await this.runWithTimeout(() => client.get(key));
      if (typeof target === 'string' && target.length > 0) {
        this.metrics.hits++;
        this.logger.log(
          {
            event: 'cache_hit',
            layer: 'redis',
            code: safeCode,
          },
          'RedisCacheService',
        );
        return target;
      }

      this.metrics.misses++;
      this.logger.log(
        {
          event: 'cache_miss',
          layer: 'redis',
          code: safeCode,
        },
        'RedisCacheService',
      );
      return null;
    } catch (error) {
      this.metrics.fallbacks++;
      this.logger.warn(
        {
          event: 'cache_redis_fallback',
          layer: 'redis',
          operation: 'get',
          code: safeCode,
          reason: this.toSafeReason(error),
        },
        'RedisCacheService',
      );
      return null;
    }
  }

  async setRedirectTarget(code: string, url: string, ttlSeconds: number): Promise<boolean> {
    const safeCode = this.safeCodeForLog(code);
    const boundedTtl = this.normalizeTtl(ttlSeconds);
    const client = this.client;

    if (!client || client.status !== 'ready') {
      this.logger.warn(
        {
          event: 'cache_redis_fallback',
          layer: 'redis',
          operation: 'set',
          code: safeCode,
          reason: client ? `redis_status_${client.status}` : 'redis_disabled',
        },
        'RedisCacheService',
      );
      return false;
    }

    const key = this.buildRedirectKey(code);
    try {
      // Never log destination url; store only key -> url with a bounded expiration.
      await this.runWithTimeout(() => client.set(key, url, 'EX', boundedTtl));
      this.logger.log(
        {
          event: 'cache_populated',
          layer: 'redis',
          code: safeCode,
          ttl_seconds: boundedTtl,
        },
        'RedisCacheService',
      );
      return true;
    } catch (error) {
      this.logger.warn(
        {
          event: 'cache_redis_fallback',
          layer: 'redis',
          operation: 'set',
          code: safeCode,
          reason: this.toSafeReason(error),
        },
        'RedisCacheService',
      );
      return false;
    }
  }

  async invalidateRedirectTarget(code: string): Promise<boolean> {
    const safeCode = this.safeCodeForLog(code);
    const client = this.client;

    if (!client || client.status !== 'ready') {
      this.metrics.invalidationFailures++;
      this.logger.warn(
        {
          event: 'cache_invalidation_failed',
          layer: 'redis',
          code: safeCode,
          reason: client ? `redis_status_${client.status}` : 'redis_disabled',
          ttl_seconds: this.defaultTtlSeconds,
        },
        'RedisCacheService',
      );
      return false;
    }

    const key = this.buildRedirectKey(code);
    try {
      await this.runWithTimeout(() => client.del(key));
      this.metrics.invalidations++;
      this.logger.log(
        {
          event: 'cache_invalidated',
          layer: 'redis',
          code: safeCode,
        },
        'RedisCacheService',
      );
      return true;
    } catch (error) {
      this.metrics.invalidationFailures++;
      this.logger.warn(
        {
          event: 'cache_invalidation_failed',
          layer: 'redis',
          code: safeCode,
          reason: this.toSafeReason(error),
          ttl_seconds: this.defaultTtlSeconds,
        },
        'RedisCacheService',
      );
      return false;
    }
  }

  async ping(): Promise<boolean> {
    const client = this.client;
    if (!client || client.status !== 'ready') {
      return false;
    }
    try {
      const res = await this.runWithTimeout(() => client.ping(), 500);
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  private normalizeTtl(ttlSeconds: number): number {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1) {
      return this.defaultTtlSeconds;
    }
    return Math.min(MAX_REDIRECT_CACHE_TTL_SECONDS, Math.floor(ttlSeconds));
  }

  private safeCodeForLog(code: string): string {
    return redactSensitiveText(code).slice(0, 64);
  }

  private toSafeReason(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    return redactSensitiveText(raw || 'redis_operation_failed');
  }

  private async runWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs = REDIS_COMMAND_TIMEOUT_MS + 100,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Redis command timed out')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

