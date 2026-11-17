import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsQueryDto } from '../analytics/dto/analytics-query.dto';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RATE_LIMIT_TTL_MS, RATE_LIMITS } from '../config/rate-limits';
import { CreateLinkDto } from './dto/create-link.dto';
import { SearchLinksQueryDto } from './dto/search-links-query.dto';
import { UpdateLinkDto } from './dto/update-link.dto';
import { LinksService } from './links.service';

@Controller('links')
@UseGuards(JwtAuthGuard)
export class LinksController {
  constructor(
    private readonly linksService: LinksService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: RATE_LIMITS.create_link_per_min, ttl: RATE_LIMIT_TTL_MS } })
  async create(
    @Body() createLinkDto: CreateLinkDto,
    @CurrentPrincipal() principalId: string,
  ) {
    return this.linksService.create(createLinkDto, principalId);
  }

  @Get()
  async findAll(
    @CurrentPrincipal() principalId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.linksService.findAll(
      principalId,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Get('search')
  async search(
    @Query() query: SearchLinksQueryDto,
    @CurrentPrincipal() principalId: string,
  ) {
    return this.linksService.search(principalId, query);
  }

  @Get(':id/analytics')
  @Throttle({ default: { limit: RATE_LIMITS.analytics_per_min, ttl: RATE_LIMIT_TTL_MS } })
  async getAnalytics(
    @Param('id') id: string,
    @Query() query: AnalyticsQueryDto,
    @CurrentPrincipal() principalId: string,
  ) {
    return this.analyticsService.getLinkAnalytics(id, principalId, query);
  }

  @Get(':id')
  async findById(
    @Param('id') id: string,
    @CurrentPrincipal() principalId: string,
  ) {
    return this.linksService.findById(id, principalId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateLinkDto: UpdateLinkDto,
    @CurrentPrincipal() principalId: string,
  ) {
    return this.linksService.update(id, updateLinkDto, principalId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentPrincipal() principalId: string,
  ) {
    return this.linksService.remove(id, principalId);
  }
}
