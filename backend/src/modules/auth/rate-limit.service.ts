/**
 * RateLimitService — Redis-backed rate limiting for auth endpoints.
 *
 * Uses the existing RedisService (application Redis pool) rather than
 * a third-party throttler library, consistent with the project's Redis
 * architecture and REDIS_SCHEMA.md key conventions.
 *
 * Algorithm: SET NX + INCR pattern (atomic, no race conditions):
 *   1. SET rl:{slug}:{id} 0 NX EX {window}   — initialises counter if absent
 *   2. INCR rl:{slug}:{id}                    — increment and read in one op
 *   3. If count > limit → throw 429
 *
 * Key pattern: `rl:{endpoint_slug}:{identifier}` per REDIS_SCHEMA.md §11
 *
 * Limits enforced (from REDIS_SCHEMA.md §11 Rate Limiting Counters):
 *   - auth_login:    5 requests / 60s  per IP
 *   - auth_register: 3 requests / 300s per IP
 *   - drivers_location: 120 requests / 60s per userId (Phase 2C)
 *
 * The generic `check()` method is public and exported for use by
 * other modules (e.g. DriversModule) without code duplication.
 *
 * Source: docs/REDIS_SCHEMA.md — §11 Rate Limiting Counters
 * Source: docs/ENGINEERING_RULES.md — "Rate limiting"
 */

import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@modules/redis/redis.service';

interface RateLimitConfig {
  /** Endpoint slug used in the Redis key */
  slug: string;
  /** Maximum allowed requests in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  // Limits defined in docs/REDIS_SCHEMA.md §11
  private readonly LOGIN_CONFIG: RateLimitConfig = {
    slug: 'auth_login',
    limit: 5,
    windowSeconds: 60,
  };

  private readonly REGISTER_CONFIG: RateLimitConfig = {
    slug: 'auth_register',
    limit: 3,
    windowSeconds: 300,
  };

  constructor(private readonly redis: RedisService) {}

  /**
   * Check and increment the login rate limit counter for the given IP.
   * Throws TooManyRequestsException (429) if the limit is exceeded.
   */
  async checkLoginLimit(identifier: string): Promise<void> {
    await this.checkLimit(identifier, this.LOGIN_CONFIG);
  }

  /**
   * Check and increment the registration rate limit counter for the given IP.
   * Throws TooManyRequestsException (429) if the limit is exceeded.
   */
  async checkRegisterLimit(identifier: string): Promise<void> {
    await this.checkLimit(identifier, this.REGISTER_CONFIG);
  }

  /**
   * Generic rate-limit check — callable by any module via DI.
   * Key pattern: `rl:{slug}:{identifier}` per REDIS_SCHEMA.md §11.
   *
   * @param slug      - endpoint identifier (e.g. 'drivers_location')
   * @param identifier - unique key per caller (userId, IP, etc.)
   * @param limit     - max requests in the window
   * @param windowSeconds - window duration in seconds
   */
  async check(
    slug: string,
    identifier: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    await this.checkLimit(identifier, { slug, limit, windowSeconds });
  }

  /**
   * Core rate-limit check using the SET NX + INCR pattern.
   *
   * The NX SET initialises the key with TTL atomically only if it doesn't exist.
   * INCR then increments and returns the new count.
   * This avoids the INCR + EXPIRE race condition.
   *
   * Source: docs/REDIS_SCHEMA.md §11 — "SET rl:{slug}:{id} 0 NX EX {window}"
   */
  private async checkLimit(
    identifier: string,
    config: RateLimitConfig,
  ): Promise<void> {
    const key = this.redis.keys.rateLimitCounter(config.slug, identifier);

    // Initialise the key with TTL if it doesn't already exist
    await this.redis.setNx(key, '0', config.windowSeconds);

    // Increment and get the new count
    const count = await this.redis.incr(key);

    if (count > config.limit) {
      this.logger.warn(
        `Rate limit exceeded: slug=${config.slug} identifier=${identifier} count=${count} limit=${config.limit}`,
      );

      throw new HttpException(
        {
          message: `Too many requests. Please try again later.`,
          code: 'RATE_LIMIT_EXCEEDED',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
