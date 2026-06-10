/**
 * JwtRefreshStrategy — validates the long-lived refresh token (Bearer header).
 *
 * Used exclusively on the token-refresh endpoint (Phase 2B).
 * The strategy extracts the token family and user ID from the payload,
 * allowing AuthService to look up the stored hashed token in PostgreSQL.
 *
 * Registered as 'jwt-refresh' to avoid collision with the 'jwt' access strategy.
 *
 * Source: docs/REDIS_SCHEMA.md — auth:refresh:{userId}:{tokenFamily} (Phase 2B)
 * Source: schema.prisma — RefreshToken model
 */

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '@common/config/app-config.service';

export interface JwtRefreshPayload {
  /** Subject — the user's UUID */
  sub: string;
  /** Token family UUID — used for refresh token rotation (Phase 2B) */
  tokenFamily: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface RefreshTokenContext {
  userId: string;
  tokenFamily: string;
  rawToken: string;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtRefreshSecret,
      passReqToCallback: true,
    });
  }

  /**
   * Passport calls this after signature + expiry check.
   * We return enough context for AuthService to validate against the DB record.
   *
   * The raw token is extracted from the Authorization header for hash comparison.
   */
  validate(req: { headers: Record<string, string> }, payload: JwtRefreshPayload): RefreshTokenContext {
    const authHeader = req.headers['authorization'] ?? '';
    const rawToken = authHeader.replace('Bearer ', '').trim();

    return {
      userId: payload.sub,
      tokenFamily: payload.tokenFamily,
      rawToken,
    };
  }
}
