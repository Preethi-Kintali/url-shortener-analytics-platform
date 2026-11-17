import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { CacheModule } from '../cache/cache.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedirectController } from '../redirect/redirect.controller';
import { LinksController } from './links.controller';
import { LinksService } from './links.service';

@Module({
  imports: [PrismaModule, AuthModule, CacheModule, AnalyticsModule],
  controllers: [LinksController, RedirectController],
  providers: [LinksService],
  exports: [LinksService],
})
export class LinksModule {}
