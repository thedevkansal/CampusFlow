/**
 * RolesGuard — enforces role-based access control after JWT validation.
 *
 * Must be used AFTER JwtAuthGuard (which populates request.user).
 * Reads the @Roles() decorator metadata and compares req.user.role.
 *
 * If no @Roles() decorator is present, access is granted (guard is a no-op).
 * This enables JwtAuthGuard to be applied globally in future without
 * breaking public endpoints.
 *
 * Enforcement pipeline per docs/RBAC.md:
 *   Request → JWT Guard → RolesGuard → OwnershipGuard → Controller → Service
 *
 * Usage:
 *   @Roles(Role.DRIVER, Role.ADMIN)
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   async myEndpoint() {}
 *
 * Source: docs/RBAC.md — "RolesGuard — Checks req.user.role against @Roles() decorator. Rejects wrong role (403)"
 * Source: common/decorators/roles.decorator.ts — @Roles() decorator (already exists)
 * Source: common/types/index.ts — Role enum (already exists)
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest, Role } from '@common/types';
import { ROLES_KEY } from '@common/decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get the roles required for this handler/class
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no @Roles() decorator is present, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException({
        message: 'You do not have permission to access this resource',
        code: 'AUTHZ_ROLE_FORBIDDEN',
      });
    }

    return true;
  }
}
