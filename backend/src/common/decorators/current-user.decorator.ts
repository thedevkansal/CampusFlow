/**
 * CurrentUser decorator — extracts the authenticated user from the request.
 *
 * Usage:
 *   async myEndpoint(@CurrentUser() user: AuthenticatedUser) {}
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest, AuthenticatedUser } from '../types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
