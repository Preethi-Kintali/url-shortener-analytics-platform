import { BadRequestException } from '@nestjs/common';

export const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;
export const MAX_TAGS_COUNT = 10;
export const MAX_TAG_LENGTH = 50;
export const MAX_SEARCH_QUERY_LENGTH = 200;
export const DEFAULT_SEARCH_PAGE = 1;
export const DEFAULT_SEARCH_PAGE_SIZE = 20;
export const MAX_SEARCH_PAGE_SIZE = 100;
export const MAX_SEARCH_PAGE = 100_000;

export function normalizeTags(rawTags?: string[]): string[] {
  if (!rawTags || rawTags.length === 0) {
    return [];
  }
  if (rawTags.length > MAX_TAGS_COUNT) {
    throw new BadRequestException(`tags array must have at most ${MAX_TAGS_COUNT} items`);
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of rawTags) {
    if (typeof item !== 'string') {
      throw new BadRequestException('each tag must be a string');
    }
    if (CONTROL_CHAR_REGEX.test(item)) {
      throw new BadRequestException('tags must not contain control characters');
    }
    const trimmed = item.trim().toLowerCase();
    if (trimmed.length === 0) {
      throw new BadRequestException('tags must not contain empty or whitespace-only values');
    }
    if (trimmed.length > MAX_TAG_LENGTH) {
      throw new BadRequestException(`each tag must be at most ${MAX_TAG_LENGTH} characters`);
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }

  return normalized;
}

export function normalizeSingleTagFilter(rawTag?: string): string | undefined {
  if (rawTag === undefined) {
    return undefined;
  }
  if (typeof rawTag !== 'string' || CONTROL_CHAR_REGEX.test(rawTag)) {
    throw new BadRequestException('tag contains invalid characters');
  }
  const trimmed = rawTag.trim().toLowerCase();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > MAX_TAG_LENGTH) {
    throw new BadRequestException(`tag must be at most ${MAX_TAG_LENGTH} characters`);
  }
  return trimmed;
}

export function normalizeSearchQuery(rawQuery?: string): string | undefined {
  if (rawQuery === undefined) {
    return undefined;
  }
  if (typeof rawQuery !== 'string' || CONTROL_CHAR_REGEX.test(rawQuery)) {
    throw new BadRequestException('q contains invalid characters');
  }
  const trimmed = rawQuery.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > MAX_SEARCH_QUERY_LENGTH) {
    throw new BadRequestException(`q must be at most ${MAX_SEARCH_QUERY_LENGTH} characters`);
  }
  return trimmed;
}

export function parsePositiveIntQueryParam(
  raw: string | undefined,
  fieldName: string,
  defaultValue: number,
  maxValue: number,
): number {
  if (raw === undefined) {
    return defaultValue;
  }
  if (typeof raw !== 'string') {
    throw new BadRequestException(`${fieldName} must be a positive integer`);
  }
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new BadRequestException(`${fieldName} must be a positive integer`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maxValue) {
    throw new BadRequestException(`${fieldName} must be between 1 and ${maxValue}`);
  }
  return parsed;
}

