/**
 * Roles decorator — attaches allowed roles metadata to a route handler.
 * Consumed by RolesGuard.
 *
 * Usage:
 *   @Roles(Role.DRIVER, Role.ADMIN)
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   async myEndpoint() {}
 *
 * Source: docs/RBAC.md
 */

import { SetMetadata } from '@nestjs/common';
import { Role } from '../types';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);
