/**
 * MatchingService — candidate discovery, filtering, and ranking.
 *
 * Steps (per docs/MATCHING_ENGINE.md §Step 2–4):
 *   1. GEO search: GEOSEARCH drivers:geo within MATCHING_RADIUS_KM
 *   2. Filter: exclude locked, non-ONLINE, and previously-tried drivers
 *      - Redis driver:status primary; PostgreSQL fallback on cache miss (REDIS_SCHEMA §1)
 *   3. Batch-fetch driver records from PostgreSQL for rating data
 *   4. Rank by weighted score:
 *        score = W_dist × distance_score + W_rating × rating_score + W_acceptance × acceptance_score
 *
 * Source: docs/MATCHING_ENGINE.md
 * Source: docs/REDIS_SCHEMA.md §1 (driver status), §3 (GEO), §7 (driver lock), §15 (timeout count)
 */

import { Injectable } from '@nestjs/common';
import { DriverStatus } from '@prisma/client';
import { RedisService } from '@modules/redis/redis.service';
import { DriversRepository } from '@modules/drivers/drivers.repository';
import { AppConfigService } from '@common/config/app-config.service';

export interface RankedCandidate {
  driverId: string;
  score: number;
  distanceKm: number;
}

@Injectable()
export class MatchingService {
  // private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly driversRepository: DriversRepository,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Discover, filter, and rank nearby available drivers.
   *
   * @param pickupLat  Passenger pickup latitude
   * @param pickupLng  Passenger pickup longitude
   * @param excludeDriverIds  Drivers to skip (previously timed-out/rejected)
   * @returns Candidates sorted by score descending; empty array = no match
   */
  async findAndRankCandidates(
    pickupLat: number,
    pickupLng: number,
    excludeDriverIds: string[],
  ): Promise<RankedCandidate[]> {
    const radiusKm = this.config.matchingRadiusKm;
    const maxCandidates = this.config.matchingMaxCandidates;

    // ── Step 2: GEO search ───────────────────────────────────────────────────
    // GEOSEARCH uses (longitude, latitude) argument order
    const geoResults = await this.redis.geoSearch(
      this.redis.keys.driversGeo(),
      pickupLng,
      pickupLat,
      radiusKm,
      maxCandidates,
    );

    if (geoResults.length === 0) return [];

    // ── Step 3: Filter ───────────────────────────────────────────────────────
    const excludeSet = new Set(excludeDriverIds);
    const eligibleDriverIds: string[] = [];
    const distanceMap = new Map<string, number>();

    for (const { member: driverId, distance } of geoResults) {
      if (excludeSet.has(driverId)) continue;

      // Driver lock check — REDIS_SCHEMA §7
      const isLocked = await this.redis.exists(this.redis.keys.driverLock(driverId));
      if (isLocked) continue;

      // Driver status — Redis primary, PostgreSQL fallback (REDIS_SCHEMA §1)
      const redisStatus = await this.redis.get(this.redis.keys.driverStatus(driverId));
      if (redisStatus !== null) {
        if (redisStatus !== 'ONLINE') continue;
      } else {
        // Cache miss: fall back to PostgreSQL
        const driver = await this.driversRepository.findByDriverId(driverId);
        if (!driver || driver.status !== DriverStatus.ONLINE) continue;
      }

      eligibleDriverIds.push(driverId);
      distanceMap.set(driverId, distance);
    }

    if (eligibleDriverIds.length === 0) return [];

    // ── Step 4: Batch-fetch from PostgreSQL ──────────────────────────────────
    const drivers = await this.driversRepository.findByDriverIds(eligibleDriverIds);

    // ── Step 5: Rank ─────────────────────────────────────────────────────────
    const wDist = this.config.matchingWeightDistance;
    const wRating = this.config.matchingWeightRating;
    const wAcceptance = this.config.matchingWeightAcceptance;

    const candidates = await Promise.all(
      drivers.map(async (driver) => {
        const distKm = distanceMap.get(driver.id) ?? radiusKm;

        const timeoutRaw = await this.redis.get(
          this.redis.keys.driverTimeoutCount(driver.id),
        );
        const timeoutCount = timeoutRaw ? parseInt(timeoutRaw, 10) : 0;

        // Normalized scores 0.0 – 1.0
        const distanceScore = Math.max(0, 1 - distKm / radiusKm);
        const ratingScore = (Number(driver.rating) - 1) / 4;
        const acceptanceScore = Math.max(0, 1 - timeoutCount / 10);

        const score =
          wDist * distanceScore +
          wRating * ratingScore +
          wAcceptance * acceptanceScore;

        return { driverId: driver.id, score, distanceKm: distKm };
      }),
    );

    return candidates.sort((a, b) => b.score - a.score);
  }
}
