import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AnalyticsModule } from './analytics/analytics.module';
import { AnalyticsService } from './analytics/analytics.service';
import { LoggingModule } from './common/logging/logging.module';
import { StructuredLoggerService } from './common/logging/structured-logger.service';
import { validateEnv } from './config/validate-env';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [LoggingModule, PrismaModule, AnalyticsModule],
})
class PurgeModule {}

async function runPurge(): Promise<void> {
  validateEnv();

  const app = await NestFactory.createApplicationContext(PurgeModule, { bufferLogs: true });
  const logger = app.get(StructuredLoggerService);
  app.useLogger(logger);

  try {
    const analyticsService = app.get(AnalyticsService);
    const result = await analyticsService.purgeExpiredClickEvents();
    logger.log({ event: 'analytics_purge_cli_completed', ...result }, 'PurgeBootstrap');
  } finally {
    await app.close();
  }
}

runPurge().catch((error) => {
  const logger = new StructuredLoggerService();
  logger.error(
    {
      event: 'analytics_purge_cli_failed',
      message: error instanceof Error ? error.message : String(error),
    },
    undefined,
    'PurgeBootstrap',
  );
  process.exit(1);
});
