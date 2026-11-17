const SENSITIVE_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|password|pass|pwd|secret|jwt_secret|token|access_token|refresh_token|api_key|apikey|x-api-key|database_url|redis_url|long_url|destination_url|target_url|credentials|email|actor_email|user_email|ip|client_ip|ip_address|x-forwarded-for|forwarded|remote_addr)$/i;

export function stripControlChars(input: string): string {
  return input.replace(/[\x00-\x1F\x7F]/g, ' ').trim();
}

export function redactSensitiveText(input: string): string {
  let sanitized = stripControlChars(input);

  // Redact database and Redis connection strings
  sanitized = sanitized.replace(/\bpostgres(?:ql)?:\/\/[^\s"'`<>]+/gi, 'postgresql://[REDACTED]');
  sanitized = sanitized.replace(/\brediss?:\/\/[^\s"'`<>]+/gi, 'redis://[REDACTED]');

  // Redact Bearer tokens
  sanitized = sanitized.replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]');

  // Redact JWTs
  sanitized = sanitized.replace(
    /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
    '[REDACTED_JWT]',
  );

  // Redact email PII
  sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');

  // Redact IPv4 PII
  sanitized = sanitized.replace(
    /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    '[REDACTED_IP]',
  );

  // Redact key=value / key: value secrets and PII fields
  sanitized = sanitized.replace(
    /\b(password|passwd|secret|jwt_secret|token|access_token|refresh_token|api_key|apikey|authorization|database_url|redis_url|long_url|destination_url|target_url|actor_email|user_email|email|client_ip|ip_address|remote_addr)\s*([:=])\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    (_match, key: string, sep: string) => `${key}${sep}[REDACTED]`,
  );

  return sanitized;
}

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) {
    return '[TRUNCATED]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitizeValue(val, depth + 1);
      }
    }
    return out;
  }
  return redactSensitiveText(String(value));
}

export function sanitizeRoutePath(rawUrl: string | undefined): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return '/';
  }
  const pathOnly = rawUrl.split('?')[0].split('#')[0];
  return redactSensitiveText(pathOnly) || '/';
}

