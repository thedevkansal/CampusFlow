/**
 * TokenService — JWT issuance and refresh token lifecycle management.
 *
 * Responsibilities:
 * - Generate signed access tokens (short-lived, 15m default)
 * - Generate signed refresh tokens (long-lived, 7d default)
 * - Hash refresh tokens for safe PostgreSQL storage (bcrypt)
 * - Persist refresh tokens to the RefreshToken table
 * - Validate a submitted refresh token against the stored hash
 *
 * Refresh token storage: PostgreSQL only (Phase 2A).
 * Redis-backed refresh token rotation is deferred to Phase 2B.
 *
 * Source: docs/REDIS_SCHEMA.md — auth:refresh:{userId}:{tokenFamily} (Phase 2B note)
 * Source: schema.prisma — RefreshToken model
 * Source: docs/RBAC.md — "/auth/refresh — Own refresh token only"
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@prisma/prisma.service';
import { AppConfigService } from '@common/config/app-config.service';
import { Role } from '@common/types';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const BCRYPT_ROUNDS = 10;

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
  driverId?: string;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenFamily: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Generate a signed, short-lived access token.
   * Includes a `jti` (JWT ID) claim for future blacklisting (Phase 2B logout).
   *
   * Source: docs/REDIS_SCHEMA.md — auth:blacklist:{jti} (Phase 2B)
   */
  generateAccessToken(payload: AccessTokenPayload): string {
    return this.jwtService.sign(
      {
        ...payload,
        jti: randomUUID(),
      },
      // @nestjs/jwt v10+ uses branded StringValue from the 'ms' package.
      // Casting through unknown avoids the type error while keeping runtime behaviour identical.
      { expiresIn: this.config.jwtAccessExpiresIn } as unknown as Parameters<typeof this.jwtService.sign>[1],
    );
  }

  /**
   * Generate a signed, long-lived refresh token.
   * tokenFamily is a UUID that ties the refresh token to a DB record
   * for validation and future rotation.
   */
  generateRefreshToken(userId: string): { token: string; tokenFamily: string } {
    const tokenFamily = randomUUID();

    const token = this.jwtService.sign(
      {
        sub: userId,
        tokenFamily,
        jti: randomUUID(),
      } satisfies RefreshTokenPayload & { jti: string },
      // Cast needed: @nestjs/jwt v10+ uses branded StringValue for expiresIn
      {
        secret: this.config.jwtRefreshSecret,
        expiresIn: this.config.jwtRefreshExpiresIn,
      } as unknown as Parameters<typeof this.jwtService.sign>[1],
    );

    return { token, tokenFamily };
  }

  /**
   * Persist a refresh token to PostgreSQL.
   * The raw token is bcrypt-hashed before storage — the plaintext is never stored.
   *
   * Source: schema.prisma — RefreshToken model (tokenHash, tokenFamily, expiresAt)
   */
  async storeRefreshToken(
    userId: string,
    tokenFamily: string,
    rawToken: string,
  ): Promise<void> {
    const tokenHash = await bcrypt.hash(rawToken, BCRYPT_ROUNDS);

    // Calculate expiry based on config (e.g. '7d' → 7 days from now)
    const expiresAt = this.parseExpiry(this.config.jwtRefreshExpiresIn);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenFamily,
        tokenHash,
        expiresAt,
      },
    });
  }

  /**
   * Validate a raw refresh token against the PostgreSQL record.
   * Checks: record exists, not revoked, not expired, hash matches.
   *
   * Throws UnauthorizedException with RBAC-aligned codes on any failure.
   */
  async validateRefreshToken(
    userId: string,
    tokenFamily: string,
    rawToken: string,
  ): Promise<void> {
    const record = await this.prisma.refreshToken.findFirst({
      where: { userId, tokenFamily },
    });

    if (!record) {
      throw new UnauthorizedException({
        message: 'Refresh token not found',
        code: 'AUTH_INVALID_TOKEN',
      });
    }

    if (record.revokedAt !== null) {
      throw new UnauthorizedException({
        message: 'Refresh token has been revoked',
        code: 'AUTH_TOKEN_REVOKED',
      });
    }

    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException({
        message: 'Refresh token has expired',
        code: 'AUTH_TOKEN_EXPIRED',
      });
    }

    const isValid = await bcrypt.compare(rawToken, record.tokenHash);
    if (!isValid) {
      throw new UnauthorizedException({
        message: 'Invalid refresh token',
        code: 'AUTH_INVALID_TOKEN',
      });
    }
  }

  /**
   * Parse a JWT expiry string (e.g. '7d', '15m', '3600') into a Date.
   * Used to set the expiresAt field in the RefreshToken record.
   */
  private parseExpiry(expiry: string): Date {
    const now = Date.now();
    const match = /^(\d+)([smhd])$/.exec(expiry);

    if (!match) {
      // Assume it's seconds if no unit
      const seconds = parseInt(expiry, 10);
      return new Date(now + seconds * 1000);
    }

    const [, valueStr, unit] = match;
    const value = parseInt(valueStr, 10);

    const multipliers: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };

    return new Date(now + value * (multipliers[unit] ?? 1_000));
  }
}
