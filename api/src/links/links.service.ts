import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { Link, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { RedisCacheService } from '../cache/redis-cache.service';
import { StructuredLoggerService } from '../common/logging/structured-logger.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLinkDto } from './dto/create-link.dto';
import { SearchLinksQueryDto } from './dto/search-links-query.dto';
import { UpdateLinkDto } from './dto/update-link.dto';
import {
  DEFAULT_SEARCH_PAGE,
  DEFAULT_SEARCH_PAGE_SIZE,
  MAX_SEARCH_PAGE,
  MAX_SEARCH_PAGE_SIZE,
  normalizeSearchQuery,
  normalizeSingleTagFilter,
  normalizeTags,
  parsePositiveIntQueryParam,
} from './validators/tag.util';
import { validateDestinationUrl } from './validators/url.validator';

const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function generateBase62Code(length = 7): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += BASE62_ALPHABET[bytes[i] % BASE62_ALPHABET.length];
  }
  return code;
}

@Injectable()
export class LinksService {
  private readonly inFlightLookups = new Map<
    string,
    Promise<{ code: string; long_url: string }>
  >();
  private readonly staleInFlightLookups = new WeakSet<Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisCacheService,
    @Optional() private readonly logger?: StructuredLoggerService,
  ) {}

  private getBaseUrl(): string {
    const port = process.env.PORT || '3000';
    return `http://localhost:${port}`;
  }

  private assertPrincipalId(principalId: string): string {
    if (typeof principalId !== 'string' || principalId.trim() === '') {
      throw new UnauthorizedException('Authenticated principal_id is required');
    }
    return principalId.trim();
  }

  private validateUrlOrThrow(rawUrl: string): void {
    const validation = validateDestinationUrl(rawUrl);
    if (!validation.valid) {
      throw new BadRequestException(validation.message || 'Invalid destination URL');
    }
  }

  private toLinkResponse(link: Link) {
    return {
      id: link.id,
      code: link.code,
      short_url: `${this.getBaseUrl()}/r/${link.code}`,
      long_url: link.longUrl,
      tags: link.tags ?? [],
      created_at: link.createdAt,
      created_by: link.createdBy,
    };
  }

  async create(dto: CreateLinkDto, principalId: string) {
    const ownerId = this.assertPrincipalId(principalId);
    this.validateUrlOrThrow(dto.long_url);
    const normalizedTags = normalizeTags(dto.tags);

    if (dto.expires_at) {
      const exp = new Date(dto.expires_at);
      if (isNaN(exp.getTime()) || exp.getTime() <= Date.now()) {
        throw new BadRequestException('expires_at must be a valid future ISO date string');
      }
    }

    // Generate unique short code with collision avoidance
    let code = generateBase62Code(7);
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await this.prisma.link.findUnique({ where: { code } });
      if (!existing) break;
      code = generateBase62Code(7);
    }

    const link = await this.prisma.link.create({
      data: {
        code,
        longUrl: dto.long_url,
        tags: normalizedTags,
        createdBy: ownerId,
      },
    });

    return this.toLinkResponse(link);
  }

  async findAll(principalId: string, page = 1, limit = 20) {
    const ownerId = this.assertPrincipalId(principalId);
    const sanitizedPage = Math.max(1, Number(page) || 1);
    const sanitizedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (sanitizedPage - 1) * sanitizedLimit;

    const ownerFilter = { createdBy: ownerId };

    const [links, total] = await Promise.all([
      this.prisma.link.findMany({
        where: ownerFilter,
        skip,
        take: sanitizedLimit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.link.count({ where: ownerFilter }),
    ]);

    return {
      data: links.map((link) => this.toLinkResponse(link)),
      total,
      page: sanitizedPage,
      limit: sanitizedLimit,
      total_pages: Math.ceil(total / sanitizedLimit),
    };
  }

  async search(principalId: string, query: SearchLinksQueryDto) {
    const ownerId = this.assertPrincipalId(principalId);
    const normalizedQ = normalizeSearchQuery(query.q);
    const normalizedTag = normalizeSingleTagFilter(query.tag);
    const page = parsePositiveIntQueryParam(
      query.page,
      'page',
      DEFAULT_SEARCH_PAGE,
      MAX_SEARCH_PAGE,
    );
    const pageSize = parsePositiveIntQueryParam(
      query.page_size,
      'page_size',
      DEFAULT_SEARCH_PAGE_SIZE,
      MAX_SEARCH_PAGE_SIZE,
    );
    const skip = (page - 1) * pageSize;

    const andClauses: Prisma.LinkWhereInput[] = [{ createdBy: ownerId }];

    if (normalizedQ) {
      andClauses.push({
        OR: [
          { longUrl: { contains: normalizedQ, mode: 'insensitive' } },
          { code: { contains: normalizedQ, mode: 'insensitive' } },
        ],
      });
    }

    if (normalizedTag) {
      andClauses.push({
        tags: { has: normalizedTag },
      });
    }

    const where: Prisma.LinkWhereInput =
      andClauses.length === 1 ? andClauses[0] : { AND: andClauses };

    const [links, total] = await Promise.all([
      this.prisma.link.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.link.count({ where }),
    ]);

    this.logger?.log(
      {
        event: 'links_searched',
        has_q: Boolean(normalizedQ),
        has_tag: Boolean(normalizedTag),
        page,
        page_size: pageSize,
        returned: links.length,
        total,
      },
      'LinksService',
    );

    return {
      data: links.map((link) => this.toLinkResponse(link)),
      pagination: {
        page,
        page_size: pageSize,
        total,
      },
    };
  }

  async findById(id: string, principalId: string) {
    const ownerId = this.assertPrincipalId(principalId);
    const link = await this.prisma.link.findFirst({
      where: { id, createdBy: ownerId },
    });

    if (!link) {
      throw new NotFoundException(`Link with ID '${id}' not found`);
    }

    return this.toLinkResponse(link);
  }

  async update(id: string, dto: UpdateLinkDto, principalId: string) {
    const ownerId = this.assertPrincipalId(principalId);
    this.validateUrlOrThrow(dto.long_url);

    const updateData: Prisma.LinkUpdateManyMutationInput = { longUrl: dto.long_url };
    if (dto.tags !== undefined) {
      updateData.tags = normalizeTags(dto.tags);
    }

    const updated = await this.prisma.link.updateMany({
      where: { id, createdBy: ownerId },
      data: updateData,
    });

    if (updated.count === 0) {
      throw new NotFoundException(`Link with ID '${id}' not found`);
    }

    const updatedLink = await this.findById(id, ownerId);
    // Prevent any concurrent pre-mutation miss lookup from repopulating stale data after invalidation.
    this.invalidateInFlight(updatedLink.code);
    // Invalidate after PostgreSQL commit succeeds; failure is logged safely without breaking writes.
    await this.cache.invalidateRedirectTarget(updatedLink.code);
    return updatedLink;
  }

  async remove(id: string, principalId: string) {
    const ownerId = this.assertPrincipalId(principalId);
    // Fetch short code before deleting so we can invalidate the redirect cache key afterwards.
    const existing = await this.prisma.link.findFirst({
      where: { id, createdBy: ownerId },
      select: { id: true, code: true },
    });

    if (!existing) {
      throw new NotFoundException(`Link with ID '${id}' not found`);
    }

    const deleted = await this.prisma.link.deleteMany({
      where: { id, createdBy: ownerId },
    });

    if (deleted.count === 0) {
      throw new NotFoundException(`Link with ID '${id}' not found`);
    }

    this.invalidateInFlight(existing.code);
    await this.cache.invalidateRedirectTarget(existing.code);
    return { deleted: true, id };
  }

  async findByCode(code: string) {
    if (typeof code !== 'string' || code.length === 0 || code.length > 128 || /[\x00-\x1F\x7F\s]/.test(code)) {
      throw new NotFoundException('Requested link was not found');
    }

    const activeBeforeCache = this.inFlightLookups.get(code);
    if (activeBeforeCache) {
      this.logger?.log({ event: 'cache_miss_coalesced', layer: 'singleflight', code }, 'LinksService');
      return activeBeforeCache;
    }

    const cachedTarget = await this.cache.getRedirectTarget(code);
    if (cachedTarget !== null) {
      return {
        code,
        long_url: cachedTarget,
      };
    }

    // Re-check after awaiting Redis so concurrent misses collapse onto one DB lookup (single-flight).
    const activeAfterCache = this.inFlightLookups.get(code);
    if (activeAfterCache) {
      this.logger?.log({ event: 'cache_miss_coalesced', layer: 'singleflight', code }, 'LinksService');
      return activeAfterCache;
    }

    let flightPromise!: Promise<{ code: string; long_url: string }>;
    flightPromise = this.resolveAndPopulateRedirect(code, () => flightPromise).finally(() => {
      if (this.inFlightLookups.get(code) === flightPromise) {
        this.inFlightLookups.delete(code);
      }
    });
    this.inFlightLookups.set(code, flightPromise);

    return flightPromise;
  }

  private invalidateInFlight(code: string): void {
    const active = this.inFlightLookups.get(code);
    if (active) {
      this.staleInFlightLookups.add(active);
      this.inFlightLookups.delete(code);
    }
  }

  private getJitteredTtlSeconds(): number {
    const baseTtl = this.cache.getDefaultTtlSeconds();
    if (baseTtl < 30) {
      return baseTtl;
    }
    const maxJitter = Math.max(1, Math.floor(baseTtl * 0.1));
    const jitterOffset = crypto.randomInt(0, maxJitter + 1);
    return Math.max(1, baseTtl - jitterOffset);
  }

  private async resolveAndPopulateRedirect(
    code: string,
    getSelfPromise: () => Promise<{ code: string; long_url: string }>,
  ): Promise<{ code: string; long_url: string }> {
    const link = await this.prisma.link.findUnique({
      where: { code },
      select: {
        code: true,
        longUrl: true,
      },
    });

    if (!link) {
      throw new NotFoundException(`Link with code '${code}' not found`);
    }

    const selfPromise = getSelfPromise();
    if (!this.staleInFlightLookups.has(selfPromise)) {
      await this.cache.setRedirectTarget(
        link.code,
        link.longUrl,
        this.getJitteredTtlSeconds(),
      );
    }

    return {
      code: link.code,
      long_url: link.longUrl,
    };
  }
}
