/**
 * RedisService — provides the application-level ioredis client.
 *
 * This is the SHARED application Redis connection pool (max 10 connections).
 * It is NOT used by BullMQ (which manages its own connections).
 * It is NOT used by Socket.IO adapter (which uses a dedicated pub/sub connection).
 *
 * Key schema: see docs/REDIS_SCHEMA.md
 *
 * Key namespacing helpers are provided to ensure all keys follow the
 * documented convention: {domain}:{entity}:{identifier}[:{subkey}]
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '@common/config/app-config.service';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    this.client = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      connectTimeout: 5000,
      retryStrategy: (times: number) => {
        if (times > 10) {
          this.logger.error('Redis connection failed after 10 retries. Giving up.');
          return null;
        }
        const delay = Math.min(times * 100, 3000);
        this.logger.warn(`Redis reconnecting in ${delay}ms (attempt ${times})`);
        return delay;
      },
    });

    this.client.on('connect', () => this.logger.log('Redis connection established'));
    this.client.on('error', (err: Error) =>
      this.logger.error('Redis error', { error: err.message }),
    );
    this.client.on('close', () => this.logger.warn('Redis connection closed'));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.log('Redis connection closed gracefully');
  }

  /** Raw client access — use only when typed helpers are insufficient */
  getClient(): Redis {
    return this.client;
  }

  // ─── Key Helpers (docs/REDIS_SCHEMA.md) ──────────────────────────────────────

  keys = {
    driverStatus: (driverId: string) => `driver:status:${driverId}`,
    driverLocation: (driverId: string) => `driver:location:${driverId}`,
    driverLock: (driverId: string) => `driver:lock:${driverId}`,
    driverTimeoutCount: (driverId: string) => `driver:timeout_count:${driverId}`,
    driverCancellationCount: (driverId: string) => `driver:cancellation_count:${driverId}`,
    driversGeo: () => `drivers:geo`,
    driversOnline: () => `drivers:online`,
    rideActive: (rideId: string) => `ride:active:${rideId}`,
    rideLock: (rideId: string) => `ride:lock:${rideId}`,
    rideAcceptanceDeadline: (rideId: string) => `ride:acceptance_deadline:${rideId}`,
    jwtBlacklist: (jti: string) => `auth:blacklist:${jti}`,
    refreshToken: (userId: string, tokenFamily: string) =>
      `auth:refresh:${userId}:${tokenFamily}`,
    rateLimitCounter: (endpointSlug: string, identifier: string) =>
      `rl:${endpointSlug}:${identifier}`,
    socketSession: (socketId: string) => `socket:session:${socketId}`,
    userSocket: (userId: string) => `user:socket:${userId}`,
    bullDedup: (queueName: string, entityId: string) => `bull:dedup:${queueName}:${entityId}`,
    demandHeatmap: () => `demand:heatmap:current`,
  } as const;

  // ─── Typed Wrappers ───────────────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, exSeconds?: number): Promise<void> {
    if (exSeconds !== undefined) {
      await this.client.set(key, value, 'EX', exSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  /**
   * Set with NX (only if not exists). Returns true if the key was set,
   * false if it already existed (lock already held).
   */
  async setNx(key: string, value: string, exSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', exSeconds, 'NX');
    return result === 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    return this.client.del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    const count = await this.client.exists(key);
    return count > 0;
  }

  async hset(key: string, fields: Record<string, string>): Promise<void> {
    await this.client.hset(key, fields);
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    const result = await this.client.hgetall(key);
    return Object.keys(result).length === 0 ? null : result;
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  async scard(key: string): Promise<number> {
    return this.client.scard(key);
  }

  // ─── GEO Commands (docs/REDIS_SCHEMA.md — Driver Geospatial Index) ────────────

  async geoAdd(key: string, longitude: number, latitude: number, member: string): Promise<void> {
    await this.client.geoadd(key, longitude, latitude, member);
  }

  async geoRemove(key: string, member: string): Promise<void> {
    await this.client.zrem(key, member);
  }

  /**
   * GEOSEARCH — returns members within radius of a point, sorted by distance.
   * Requires Redis 6.2+ (redis:7-alpine satisfies this).
   *
   * Source: docs/REDIS_SCHEMA.md — Driver Geospatial Index
   * Source: docs/MATCHING_ENGINE.md — Step 2: Candidate Discovery
   */
  async geoSearch(
    key: string,
    longitude: number,
    latitude: number,
    radiusKm: number,
    count: number,
  ): Promise<Array<{ member: string; distance: number }>> {
    const results = await this.client.call(
      'GEOSEARCH',
      key,
      'FROMLONLAT',
      String(longitude),
      String(latitude),
      'BYRADIUS',
      String(radiusKm),
      'km',
      'ASC',
      'COUNT',
      String(count),
      'WITHCOORD',
      'WITHDIST',
    ) as Array<[string, string, [string, string]]>;

    return results.map(([member, distance]) => ({
      member,
      distance: parseFloat(distance),
    }));
  }

  // ─── Health Check ─────────────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
