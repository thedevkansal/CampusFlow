/**
 * JwtAccessStrategy — validates the short-lived access token (Bearer header).
 *
 * On successful validation, `validate()` returns the `AuthenticatedUser` object
 * which NestJS attaches to `request.user`.
 *
 * JWT payload shape (defined at token-generation time in TokenService):
 *   { sub: userId, email, role, driverId? }
 *
 * Source: docs/RBAC.md — "Role is embedded in the JWT payload as the `role` claim"
 * Source: docs/ENGINEERING_RULES.md — "JWT authentication"
 * Source: common/types/index.ts — AuthenticatedUser interface
 */

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '@common/config/app-config.service';
import { AuthenticatedUser, Role } from '@common/types';

export interface JwtAccessPayload {
  /** Subject — the user's UUID */
  sub: string;
  email: string;
  role: Role;
  /** Present only when role === DRIVER */
  driverId?: string;
  /** JWT ID — unique per token; used for blacklist checks (Phase 2B logout) */
  jti: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
    });
  }

  /**
   * Called by Passport after signature + expiry validation succeeds.
   * Return value becomes `request.user`.
   *
   * Source: common/types/index.ts — AuthenticatedUser
   */
  validate(payload: JwtAccessPayload): AuthenticatedUser {
    return {
      id: payload.sub,
      role: payload.role,
      driverId: payload.driverId,
    };
  }
}
