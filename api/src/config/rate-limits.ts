export const RATE_LIMIT_TTL_MS = 60_000;

export const RATE_LIMITS = {
  login_per_min: 10,
  create_link_per_min: 30,
  redirect_per_min: 120,
  analytics_per_min: 60,
} as const;

