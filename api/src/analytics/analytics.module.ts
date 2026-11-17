import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsQueueService } from './analytics-queue.service';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [PrismaModule],
  providers: [AnalyticsQueueService, AnalyticsService],
  exports: [AnalyticsQueueService, AnalyticsService],
})
export class AnalyticsModule {}

