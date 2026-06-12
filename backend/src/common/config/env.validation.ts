/**
 * Environment validation schema.
 * Every environment variable the application reads must be declared here.
 * Joi validation runs at startup — the app will refuse to boot with invalid config.
 *
 * Source: docs/ENGINEERING_RULES.md — "Environment variables only. No secrets in source code."
 */

import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().integer().min(1024).max(65535).default(3001),

  // Database
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),

  // Redis
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),

  // JWT — minimum 64-character secrets enforced
  JWT_SECRET: Joi.string().min(64).required(),
  JWT_REFRESH_SECRET: Joi.string().min(64).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Matching Engine — all configurable per docs/MATCHING_ENGINE.md
  FARE_BASE_FARE: Joi.number().positive().default(50),
  FARE_PER_KM_RATE: Joi.number().positive().default(12),
  MATCHING_RADIUS_KM: Joi.number().positive().default(5),
  MATCHING_MAX_CANDIDATES: Joi.number().integer().positive().default(20),
  MATCHING_TOP_N: Joi.number().integer().positive().default(3),
  MATCHING_ACCEPTANCE_WINDOW_MS: Joi.number().integer().positive().default(15000),
  MATCHING_MAX_RETRY_COUNT: Joi.number().integer().min(0).default(0),
  MATCHING_WEIGHT_DISTANCE: Joi.number().min(0).max(1).default(0.5),
  MATCHING_WEIGHT_RATING: Joi.number().min(0).max(1).default(0.3),
  MATCHING_WEIGHT_ACCEPTANCE: Joi.number().min(0).max(1).default(0.2),

  // Monitoring
  SENTRY_DSN: Joi.string().uri().optional(),

  // Rate limiting
  THROTTLE_TTL_MS: Joi.number().integer().positive().default(60000),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(300),

  // CORS
  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),
}).custom((value: Record<string, number>, helpers) => {
  // Enforce that matching weights sum to 1.0
  const sum =
    (value['MATCHING_WEIGHT_DISTANCE'] ?? 0) +
    (value['MATCHING_WEIGHT_RATING'] ?? 0) +
    (value['MATCHING_WEIGHT_ACCEPTANCE'] ?? 0);

  if (Math.abs(sum - 1.0) > 0.001) {
    return helpers.error('any.invalid', {
      message: `Matching weights must sum to 1.0. Current sum: ${sum.toFixed(3)}`,
    });
  }

  return value;
});
