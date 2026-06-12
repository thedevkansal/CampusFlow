/**
 * AppConfigService — typed wrapper over @nestjs/config.
 *
 * All environment variable reads across the application must go through this service.
 * Direct `process.env` access is forbidden in application code.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  // ─── Application ─────────────────────────────────────────────────────────────

  get nodeEnv(): string {
    return this.configService.getOrThrow<string>('NODE_ENV');
  }

  get port(): number {
    return this.configService.getOrThrow<number>('PORT');
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  // ─── Database ────────────────────────────────────────────────────────────────

  get databaseUrl(): string {
    return this.configService.getOrThrow<string>('DATABASE_URL');
  }

  // ─── Redis ───────────────────────────────────────────────────────────────────

  get redisUrl(): string {
    return this.configService.getOrThrow<string>('REDIS_URL');
  }

  // ─── JWT ─────────────────────────────────────────────────────────────────────

  get jwtSecret(): string {
    return this.configService.getOrThrow<string>('JWT_SECRET');
  }

  get jwtRefreshSecret(): string {
    return this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  get jwtAccessExpiresIn(): string {
    return this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '15m');
  }

  get jwtRefreshExpiresIn(): string {
    return this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
  }

  // ─── Pricing ─────────────────────────────────────────────────────────────────

  get fareBaseFare(): number {
    return this.configService.get<number>('FARE_BASE_FARE', 50);
  }

  get farePerKmRate(): number {
    return this.configService.get<number>('FARE_PER_KM_RATE', 12);
  }

  // ─── Matching Engine ─────────────────────────────────────────────────────────

  get matchingRadiusKm(): number {
    return this.configService.get<number>('MATCHING_RADIUS_KM', 5);
  }

  get matchingMaxCandidates(): number {
    return this.configService.get<number>('MATCHING_MAX_CANDIDATES', 20);
  }

  get matchingTopN(): number {
    return this.configService.get<number>('MATCHING_TOP_N', 3);
  }

  get matchingAcceptanceWindowMs(): number {
    return this.configService.get<number>('MATCHING_ACCEPTANCE_WINDOW_MS', 15000);
  }

  get matchingMaxRetryCount(): number {
    return this.configService.get<number>('MATCHING_MAX_RETRY_COUNT', 0);
  }

  get matchingWeightDistance(): number {
    return this.configService.get<number>('MATCHING_WEIGHT_DISTANCE', 0.5);
  }

  get matchingWeightRating(): number {
    return this.configService.get<number>('MATCHING_WEIGHT_RATING', 0.3);
  }

  get matchingWeightAcceptance(): number {
    return this.configService.get<number>('MATCHING_WEIGHT_ACCEPTANCE', 0.2);
  }

  // ─── Monitoring ──────────────────────────────────────────────────────────────

  get sentryDsn(): string | undefined {
    return this.configService.get<string>('SENTRY_DSN');
  }

  // ─── Throttling ──────────────────────────────────────────────────────────────

  get throttleTtlMs(): number {
    return this.configService.get<number>('THROTTLE_TTL_MS', 60000);
  }

  get throttleLimit(): number {
    return this.configService.get<number>('THROTTLE_LIMIT', 300);
  }

  // ─── CORS ────────────────────────────────────────────────────────────────────

  get corsOrigins(): string[] {
    const raw = this.configService.get<string>('CORS_ORIGINS', 'http://localhost:3000');
    return raw.split(',').map((o) => o.trim());
  }
}
