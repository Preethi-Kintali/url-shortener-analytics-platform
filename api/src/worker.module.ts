import { Module } from '@nestjs/common';
import { AnalyticsModule } from './analytics/analytics.module';
import { AnalyticsWorkerService } from './analytics/analytics-worker.service';
import { LoggingModule } from './common/logging/logging.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [LoggingModule, PrismaModule, AnalyticsModule],
  providers: [AnalyticsWorkerService],
})
export class WorkerModule {}

