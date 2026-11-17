import * as crypto from 'crypto';
import { stripControlChars } from '../common/logging/redaction.util';

export interface RedirectRequestLike {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: {
    remoteAddress?: string;
  };
}

export function normalizeClientIp(rawIp: string | undefined): string {
  if (!rawIp || typeof rawIp !== 'string') {
    return 'unknown';
  }
  let trimmed = rawIp.trim();
  if (trimmed.startsWith('::ffff:')) {
    trimmed = trimmed.slice(7);
  }
  return trimmed || 'unknown';
}

export function extractClientIp(req?: RedirectRequestLike): string {
  if (!req) {
    return 'unknown';
  }
  const candidate = req.ip || req.socket?.remoteAddress;
  return normalizeClientIp(candidate);
}

export function hashClientIp(rawIp: string, secret: string): string {
  const normalized = normalizeClientIp(rawIp);
  return crypto.createHmac('sha256', secret).update(normalized).digest('hex');
}

export function extractSanitizedHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  headerName: string,
  maxLength = 512,
): string {
  if (!headers) {
    return '';
  }
  const raw = headers[headerName.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    return '';
  }
  return stripControlChars(value).slice(0, maxLength);
}

