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
   * Liveness Probe: GET /health and GET /live
   * Signals whether the HTTP server process is running, responsive, and not blocked.
   * Returns HTTP 200 { ok: true } immediately without external network dependencies.
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  health() {
    return { ok: true };
  }

  @Get('live')
  @HttpCode(HttpStatus.OK)
  live() {
    return this.health();
  }

  /**
   * Readiness Probe: GET /ready
   * Signals whether the service is ready to accept user ingress traffic.
   * Verifies critical backing dependencies (PostgreSQL pool and Redis broker)
   * with short, aggressive fail-fast timeouts to prevent probe stall cascades.
   * Returns HTTP 200 when all dependencies are ready, HTTP 503 when degraded.
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: HttpResponseLike) {
    const checks: Record<string, string | number> = {};
    let ready = true;

    const isDbReady = await this.checkDb();
    if (isDbReady) {
      checks.database = 'connected';
    } else {
      checks.database = 'disconnected';
      ready = false;
    }

    const isRedisReady = await this.checkRedis();
    if (isRedisReady) {
      checks.cache = 'connected';
    } else {
      checks.cache = 'disconnected';
      ready = false;
    }

    checks.uptime_seconds = Math.floor(process.uptime());

    const status = ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    res.status(status);
    return {
      ok: ready,
      checks,
      status: ready ? 'ready' : 'unready',
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
