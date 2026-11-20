import { z } from 'zod';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env file in development unless SKIP_DOTENV is set or in production
if (!process.env.SKIP_DOTENV && process.env.NODE_ENV !== 'production') {
  const cwdEnv = path.resolve(process.cwd(), '.env');
  const parentEnv = path.resolve(process.cwd(), '..', '.env');
  if (fs.existsSync(cwdEnv)) {
    dotenv.config({ path: cwdEnv });
  } else if (fs.existsSync(parentEnv)) {
    dotenv.config({ path: parentEnv });
  } else {
    dotenv.config();
  }
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production']).optional(),
    APP_ENV: z.enum(['development', 'staging', 'production']).optional(),
    PORT: z.coerce.number().int().min(1).max(65535),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
    CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN is required'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((data, ctx) => {
    const envVal = data.APP_ENV || data.NODE_ENV;
    if (!envVal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Missing required environment variable: NODE_ENV or APP_ENV must be set to 'development', 'staging', or 'production'",
        path: ['NODE_ENV'],
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  const formatted = parsed.error.format();
  for (const [key, issues] of Object.entries(formatted)) {
    if (key === '_errors') continue;
    const errObj = issues as { _errors: string[] };
    if (errObj._errors && errObj._errors.length > 0) {
      console.error(
        `Missing required environment variable: ${key} (${errObj._errors.join(', ')})`,
      );
    }
  }
  process.exit(1);
}

const resolvedEnv = (parsed.data.APP_ENV || parsed.data.NODE_ENV || 'development') as
  | 'development'
  | 'staging'
  | 'production';

export interface AppConfig {
  NODE_ENV: 'development' | 'staging' | 'production';
  APP_ENV: 'development' | 'staging' | 'production';
  PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
}

export const config: AppConfig = {
  NODE_ENV: resolvedEnv,
  APP_ENV: resolvedEnv,
  PORT: parsed.data.PORT,
  DATABASE_URL: parsed.data.DATABASE_URL,
  JWT_SECRET: parsed.data.JWT_SECRET,
  CORS_ORIGIN: parsed.data.CORS_ORIGIN,
  LOG_LEVEL: parsed.data.LOG_LEVEL,
};
