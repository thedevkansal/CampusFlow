/**
 * DevOnlyGuard — blocks the decorated route in production.
 *
 * Applied to POST /rides/:id/assign which is a temporary manual assignment
 * endpoint used during development/testing. The MatchingModule (Phase 3C)
 * handles assignment automatically in production via BullMQ.
 *
 * Throws 403 when NODE_ENV === 'production'.
 *
 * Source: Phase 3C design decision — POST /rides/:id/assign disabled in production
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class DevOnlyGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException({
        message: 'This endpoint is not available in production',
        code: 'ENDPOINT_DISABLED_IN_PRODUCTION',
      });
    }
    return true;
  }
}
