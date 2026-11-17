import {
  Controller,
  Get,
  Param,
  Redirect,
  HttpStatus,
  Optional,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import * as crypto from 'crypto';
import { AnalyticsQueueService } from '../analytics/analytics-queue.service';
import {
  extractClientIp,
  extractSanitizedHeader,
  hashClientIp,
  RedirectRequestLike,
} from '../analytics/ip-hash.util';
import { getCurrentRequestId } from '../common/middleware/request-id.util';
import { RATE_LIMIT_TTL_MS, RATE_LIMITS } from '../config/rate-limits';
import { getAnalyticsConfig } from '../config/validate-env';
import { LinksService } from '../links/links.service';

@Controller('r')
export class RedirectController {
  private readonly ipHashSecret: string;

  constructor(
    private readonly linksService: LinksService,
    @Optional() private readonly analyticsQueue?: AnalyticsQueueService,
  ) {
    this.ipHashSecret = getAnalyticsConfig().ipHashSecret;
  }

  @Get(':code')
  @Redirect()
  @Throttle({ default: { limit: RATE_LIMITS.redirect_per_min, ttl: RATE_LIMIT_TTL_MS } })
  async redirect(@Param('code') code: string, @Req() req?: RedirectRequestLike) {
    const link = await this.linksService.findByCode(code);

    if (this.analyticsQueue) {
      const eventId = crypto.randomUUID();
      const clickedAt = new Date().toISOString();
      const userAgent = extractSanitizedHeader(req?.headers, 'user-agent');
      const referrer =
        extractSanitizedHeader(req?.headers, 'referer') ||
        extractSanitizedHeader(req?.headers, 'referrer');
      const ipHash = hashClientIp(extractClientIp(req), this.ipHashSecret);
      const requestId = getCurrentRequestId();

      try {
        await this.analyticsQueue.enqueueClickEvent({
          eventId,
          code: link.code,
          clickedAt,
          userAgent,
          referrer,
          ipHash,
          requestId,
        });
      } catch {
        // Non-critical analytics failures must never break HTTP 302 redirects
      }
    }

    return {
      url: link.long_url,
      statusCode: HttpStatus.FOUND,
    };
  }
}
