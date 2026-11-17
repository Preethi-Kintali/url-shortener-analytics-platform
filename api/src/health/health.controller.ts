import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HttpResponseLike } from '../common/middleware/request-id.util';
import { PrismaService } from '../prisma/prisma.service';
import { RedisCacheService } from '../cache/redis-cache.service';

@Controller()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisCache: RedisCacheService,
  ) {}

  /**
   * Liveness Probe: GET /health
   * Signals whether the HTTP server process is running, responsive, and not blocked.
   * Returns HTTP 200 { ok: true } immediately without external network dependencies.
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  health() {
    return { ok: true };
  }

  /**
   * Readiness Probe: GET /ready
   * Signals whether the service is ready to accept user ingress traffic.
   * Verifies critical backing dependencies (PostgreSQL pool and Redis broker).
   * Returns HTTP 200 when ready, HTTP 503 when degraded or dependencies are unreachable.
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: HttpResponseLike) {
    const isDbReady = await this.checkDb();
    const isRedisReady = await this.checkRedis();

    if (isDbReady && isRedisReady) {
      res.status(HttpStatus.OK);
      return {
        ok: true,
        status: 'ready',
        db: 'ok',
        redis: 'ok',
      };
    }

    res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      ok: false,
      status: 'unready',
      db: isDbReady ? 'ok' : 'unreachable',
      redis: isRedisReady ? 'ok' : 'unreachable',
    };
  }

  /**
   * Alias: GET /health/ready
   * Provided for compatibility with orchestrators using subpath conventions.
   */
  @Get('health/ready')
  healthReady(@Res({ passthrough: true }) res: HttpResponseLike) {
    return this.ready(res);
  }

  private async checkDb(): Promise<boolean> {
    try {
      return await this.prisma.ping();
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      return await this.redisCache.ping();
    } catch {
      return false;
    }
  }
}
