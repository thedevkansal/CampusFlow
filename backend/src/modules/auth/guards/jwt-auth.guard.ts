/**
 * JwtAuthGuard — protects routes requiring a valid access token.
 *
 * Extends the Passport 'jwt' guard. On failure, overrides handleRequest to
 * throw the structured error codes defined in docs/RBAC.md:
 *   - AUTH_INVALID_TOKEN (401) — missing/invalid token
 *   - AUTH_TOKEN_EXPIRED (401) — token expired
 *
 * The GlobalExceptionFilter catches UnauthorizedException and maps it to
 * the standard { success: false, error, code } envelope.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard)
 *   async myEndpoint(@CurrentUser() user: AuthenticatedUser) {}
 *
 * Source: docs/RBAC.md — "JWT Guard — Validates token signature and expiry. Rejects unauthenticated requests (401)"
 * Source: docs/RBAC.md — Error Responses table
 */

import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { AuthenticatedUser } from '@common/types';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return super.canActivate(context);
  }

  /**
   * Override to produce error codes matching docs/RBAC.md error response table.
   * GlobalExceptionFilter reads the `code` property from the exception response.
   */
  handleRequest<TUser = AuthenticatedUser>(
    err: Error | null,
    user: TUser | false,
    info: { name?: string; message?: string } | undefined,
  ): TUser {
    if (err || !user) {
      // Distinguish expired tokens from invalid ones
      const isExpired = info?.name === 'TokenExpiredError';
      const code = isExpired ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_INVALID_TOKEN';
      const message = isExpired ? 'Token has expired' : 'Invalid or missing authentication token';

      throw new UnauthorizedException({ message, code });
    }

    return user;
  }
}
