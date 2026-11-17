import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { StructuredLoggerService } from '../common/logging/structured-logger.service';
import { getAnalyticsConfig } from '../config/validate-env';
import { PrismaService } from '../prisma/prisma.service';
import { ClickEventJobPayload } from './analytics.constants';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PersistClickStatus = 'persisted' | 'duplicate_ignored' | 'skipped_missing_link';

export interface PersistClickResult {
  status: PersistClickStatus;
  idempotencyKey: string;
  linkId?: string;
}

export interface LinkAnalyticsSummary {
  link_id: string;
  code: string;
  from: string;
  to: string;
  total_clicks: number;
  last_clicked_at: string | null;
}

export interface RetentionPurgeResult {
  retention_days: number;
  cutoff_at: string;
  deleted_count: number;
}

function getPrismaErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly logger?: StructuredLoggerService,
  ) {}

  async persistClickEvent(payload: ClickEventJobPayload): Promise<PersistClickResult> {
    if (!payload || typeof payload.eventId !== 'string' || payload.eventId.trim() === '') {
      throw new BadRequestException('Click event payload must include a valid eventId');
    }
    if (typeof payload.code !== 'string' || payload.code.trim() === '') {
      throw new BadRequestException('Click event payload must include a valid short code');
    }

    let resolvedLinkId = payload.linkId;
    if (!resolvedLinkId) {
      const link = await this.prisma.link.findUnique({
        where: { code: payload.code },
        select: { id: true },
      });
      if (!link) {
        return {
          status: 'skipped_missing_link',
          idempotencyKey: payload.eventId,
        };
      }
      resolvedLinkId = link.id;
    }

    const clickedAtDate = payload.clickedAt ? new Date(payload.clickedAt) : new Date();
    if (Number.isNaN(clickedAtDate.getTime())) {
      throw new BadRequestException('Click event payload contains invalid clickedAt timestamp');
    }

    try {
      await this.prisma.clickEvent.create({
        data: {
          idempotencyKey: payload.eventId,
          linkId: resolvedLinkId,
          clickedAt: clickedAtDate,
          userAgent: (payload.userAgent || '').slice(0, 512),
          referrer: (payload.referrer || '').slice(0, 512),
          ipHash: payload.ipHash || '',
        },
      });

      return {
        status: 'persisted',
        idempotencyKey: payload.eventId,
        linkId: resolvedLinkId,
      };
    } catch (error) {
      const code = getPrismaErrorCode(error);
      if (code === 'P2002') {
        return {
          status: 'duplicate_ignored',
          idempotencyKey: payload.eventId,
          linkId: resolvedLinkId,
        };
      }
      if (code === 'P2003') {
        return {
          status: 'skipped_missing_link',
          idempotencyKey: payload.eventId,
          linkId: resolvedLinkId,
        };
      }
      throw error;
    }
  }

  async getLinkAnalytics(
    id: string,
    principalId: string,
    query: AnalyticsQueryDto,
  ): Promise<LinkAnalyticsSummary> {
    if (typeof principalId !== 'string' || principalId.trim() === '') {
      throw new UnauthorizedException('Authenticated principal_id is required');
    }
    const ownerId = principalId.trim();

    const { fromDate, toDate } = this.parseDateRange(query.from, query.to);

    const link = await this.prisma.link.findFirst({
      where: { id, createdBy: ownerId },
      select: { id: true, code: true },
    });

    if (!link) {
      throw new NotFoundException(`Link with ID '${id}' not found`);
    }

    const aggregate = await this.prisma.clickEvent.aggregate({
      where: {
        linkId: link.id,
        clickedAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      _count: { _all: true },
      _max: { clickedAt: true },
    });

    return {
      link_id: link.id,
      code: link.code,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      total_clicks: aggregate._count._all,
      last_clicked_at: aggregate._max.clickedAt ? aggregate._max.clickedAt.toISOString() : null,
    };
  }

  async purgeExpiredClickEvents(retentionDaysOverride?: number): Promise<RetentionPurgeResult> {
    const config = getAnalyticsConfig(retentionDaysOverride);

    if (config.zeroRetentionBlockedInProd) {
      this.logger?.warn(
        {
          event: 'analytics_zero_retention_blocked',
          effective_retention_days: config.retentionDays,
        },
        'AnalyticsService',
      );
    }

    const cutoff =
      config.retentionDays === 0
        ? new Date()
        : new Date(Date.now() - config.retentionDays * DAY_MS);

    const deleted = await this.prisma.clickEvent.deleteMany({
      where: {
        clickedAt: {
          lt: cutoff,
        },
      },
    });

    const result: RetentionPurgeResult = {
      retention_days: config.retentionDays,
      cutoff_at: cutoff.toISOString(),
      deleted_count: deleted.count,
    };

    this.logger?.log(
      {
        event: 'analytics_retention_purged',
        ...result,
      },
      'AnalyticsService',
    );

    return result;
  }

  private parseDateRange(
    rawFrom?: string,
    rawTo?: string,
  ): { fromDate: Date; toDate: Date } {
    const now = new Date();
    const fromDate = rawFrom
      ? this.parseIsoDateOrThrow(rawFrom, 'from', false)
      : new Date(now.getTime() - 30 * DAY_MS);
    const toDate = rawTo
      ? this.parseIsoDateOrThrow(rawTo, 'to', true)
      : now;

    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException("'from' date must be earlier than or equal to 'to' date");
    }

    return { fromDate, toDate };
  }

  private parseIsoDateOrThrow(raw: string, fieldName: string, isEndBoundary: boolean): Date {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new BadRequestException(`Query parameter '${fieldName}' must not be empty`);
    }

    const dateOnlyMatch = DATE_ONLY_REGEX.exec(trimmed);
    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]);
      const day = Number(dateOnlyMatch[3]);
      const probe = new Date(
        Date.UTC(
          year,
          month - 1,
          day,
          isEndBoundary ? 23 : 0,
          isEndBoundary ? 59 : 0,
          isEndBoundary ? 59 : 0,
          isEndBoundary ? 999 : 0,
        ),
      );
      if (
        probe.getUTCFullYear() !== year ||
        probe.getUTCMonth() !== month - 1 ||
        probe.getUTCDate() !== day
      ) {
        throw new BadRequestException(`Invalid calendar date for '${fieldName}'`);
      }
      return probe;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `Query parameter '${fieldName}' must be a valid ISO-8601 date or timestamp`,
      );
    }
    return parsed;
  }
}

