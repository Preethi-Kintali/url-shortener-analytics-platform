import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { CacheModule } from './cache/cache.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingModule } from './common/logging/logging.module';
import { ResilienceModule } from './common/resilience/resilience.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RATE_LIMIT_TTL_MS } from './config/rate-limits';
import { HealthModule } from './health/health.module';
import { LinksModule } from './links/links.module';
import { PrismaModule } from './prisma/prisma.module';
import { MetricsModule } from './metrics/metrics.module';
import { MetricsMiddleware } from './metrics/metrics.middleware';

@Module({
  imports: [
    LoggingModule,
    ResilienceModule,
    MetricsModule,
    CacheModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: RATE_LIMIT_TTL_MS,
        limit: 60,
      },
    ]),
    HealthModule,
    PrismaModule,
    AuthModule,
    LinksModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, MetricsMiddleware).forRoutes('*');
  }
}
