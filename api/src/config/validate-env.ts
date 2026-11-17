import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

export interface ValidatedEnv {
  port: number;
  jwtSecret: string;
}

const PLACEHOLDER_SECRET = 'replace-me-locally';
const MIN_JWT_SECRET_LENGTH = 32;
export const DEFAULT_REDIRECT_CACHE_TTL_SECONDS = 300;
export const MAX_REDIRECT_CACHE_TTL_SECONDS = 3600;
export const DEFAULT_ANALYTICS_RETENTION_DAYS = 30;
export const MAX_ANALYTICS_RETENTION_DAYS = 3650;

export interface AnalyticsEnvConfig {
  retentionDays: number;
  ipHashSecret: string;
  zeroRetentionBlockedInProd?: boolean;
}

export interface RedisEnvConfig {
  redisUrl: string | null;
  redirectTtlSeconds: number;
  invalidReason?: string;
}

function loadEnvFile(): void {
  const cwdEnv = path.resolve(process.cwd(), '.env');
  const packageEnv = path.resolve(__dirname, '../../.env');
  const envPath = fs.existsSync(cwdEnv) ? cwdEnv : packageEnv;
  dotenv.config({ path: envPath });
}

export function getRedisConfig(): RedisEnvConfig {
  loadEnvFile();

  const rawTtl = process.env.REDIS_TTL_SECONDS?.trim();
  let redirectTtlSeconds = DEFAULT_REDIRECT_CACHE_TTL_SECONDS;
  if (rawTtl && /^\d+$/.test(rawTtl)) {
    const parsedTtl = Number(rawTtl);
    if (parsedTtl >= 1) {
      redirectTtlSeconds = Math.min(MAX_REDIRECT_CACHE_TTL_SECONDS, parsedTtl);
    }
  }

  const rawRedisUrl = process.env.REDIS_URL;
  if (!rawRedisUrl || rawRedisUrl.trim() === '') {
    return {
      redisUrl: null,
      redirectTtlSeconds,
      invalidReason: 'REDIS_URL is missing or empty',
    };
  }

  const trimmed = rawRedisUrl.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
      return {
        redisUrl: null,
        redirectTtlSeconds,
        invalidReason: 'REDIS_URL must use redis:// or rediss:// scheme',
      };
    }
    return {
      redisUrl: trimmed,
      redirectTtlSeconds,
    };
  } catch {
    return {
      redisUrl: null,
      redirectTtlSeconds,
      invalidReason: 'REDIS_URL is not a valid URL',
    };
  }
}

export function getJwtSecret(): string {
  loadEnvFile();
  const rawSecret = process.env.JWT_SECRET;

  if (!rawSecret || rawSecret.trim() === '') {
    throw new Error('Startup failed: JWT_SECRET environment variable is missing in .env.');
  }

  const trimmed = rawSecret.trim();
  if (trimmed === PLACEHOLDER_SECRET) {
    throw new Error('Startup failed: JWT_SECRET must be replaced with a real secret value.');
  }

  if (trimmed.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `Startup failed: JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long.`,
    );
  }

  return trimmed;
}

export function validateEnv(): ValidatedEnv {
  loadEnvFile();

  const rawPort = process.env.PORT;

  if (rawPort === undefined || rawPort === null || rawPort.trim() === '') {
    throw new Error(
      'Startup failed: PORT environment variable is missing in .env. Please set PORT (e.g., PORT=3000).',
    );
  }

  const trimmedPort = rawPort.trim();

  // Validate that PORT contains strictly numeric digits
  if (!/^\d+$/.test(trimmedPort)) {
    throw new Error(
      `Startup failed: PORT environment variable must contain only numeric digits. Received: "${rawPort}".`,
    );
  }

  const port = Number(trimmedPort);

  if (port < 1 || port > 65535) {
    throw new Error(
      `Startup failed: PORT environment variable must be between 1 and 65535. Received: ${port}.`,
    );
  }

  const jwtSecret = getJwtSecret();

  return { port, jwtSecret };
}

export function getAnalyticsConfig(overrideRetentionDays?: number): AnalyticsEnvConfig {
  loadEnvFile();

  let retentionDays = DEFAULT_ANALYTICS_RETENTION_DAYS;
  let zeroRetentionBlockedInProd = false;

  const rawRetention =
    overrideRetentionDays !== undefined
      ? String(overrideRetentionDays)
      : process.env.ANALYTICS_RETENTION_DAYS?.trim();

  if (rawRetention !== undefined && rawRetention !== '') {
    if (/^\d+$/.test(rawRetention)) {
      const parsed = Number(rawRetention);
      if (parsed === 0 && process.env.NODE_ENV === 'production') {
        zeroRetentionBlockedInProd = true;
      } else {
        retentionDays = Math.min(MAX_ANALYTICS_RETENTION_DAYS, parsed);
      }
    }
  }

  const explicitSalt = process.env.ANALYTICS_IP_SALT?.trim();
  const jwtSecret = process.env.JWT_SECRET?.trim();
  const ipHashSecret =
    explicitSalt && explicitSalt.length >= 16
      ? explicitSalt
      : jwtSecret && jwtSecret.length >= 16
        ? `ip-hash:${jwtSecret}`
        : 'dev-only-ephemeral-ip-hash-key';

  return {
    retentionDays,
    ipHashSecret,
    ...(zeroRetentionBlockedInProd ? { zeroRetentionBlockedInProd: true } : {}),
  };
}
