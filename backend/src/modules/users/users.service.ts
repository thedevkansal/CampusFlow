/**
 * UsersService — business logic for user profile operations.
 *
 * Ownership is implicit: every method operates on the caller's own userId,
 * sourced from the validated JWT via `req.user.id`. No `:id` param means
 * no cross-user attack surface.
 *
 * Source: docs/RBAC.md — /users/profile GET 🔒 PATCH 🔒 ownership: userId = req.user.id
 * Source: docs/ENGINEERING_RULES.md — "No business logic in controllers"
 * Source: docs/ENGINEERING_RULES.md — "Every major action must be traceable"
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UsersRepository } from '@modules/auth/users.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from '@common/types';

export interface UserProfileData {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
  /** Present only when role === DRIVER */
  driverId?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly usersRepository: UsersRepository) {}

  /**
   * Return the authenticated caller's full profile.
   * Includes driverId when the caller is a DRIVER.
   *
   * Source: docs/RBAC.md — GET /users/profile PASSENGER 🔒 DRIVER 🔒 ADMIN 👑
   */
  async getProfile(userId: string): Promise<UserProfileData> {
    const user = await this.usersRepository.findByIdWithDriver(userId);

    if (!user) {
      throw new NotFoundException({
        message: 'User not found',
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      driverId: user.driver?.id,
    };
  }

  /**
   * Update the authenticated caller's own profile.
   * Only `name` is mutable — immutability of email/role/id is enforced at DTO level.
   * If `dto.name` is undefined (empty PATCH body), the call is a no-op.
   *
   * Source: docs/RBAC.md — PATCH /users/profile PASSENGER 🔒 DRIVER 🔒 ADMIN ❌
   */
  async updateProfile(userId: string, dto: UpdateUserDto): Promise<UserProfileData> {
    const existing = await this.usersRepository.findById(userId);

    if (!existing) {
      throw new NotFoundException({
        message: 'User not found',
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    // PATCH semantics: no-op when no fields provided
    if (dto.name === undefined) {
      return {
        id: existing.id,
        email: existing.email,
        name: existing.name,
        role: existing.role as Role,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }

    const updated = await this.usersRepository.updateName(userId, dto.name);

    this.logger.log(`User profile updated: id=${userId} name="${dto.name}"`);

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role as Role,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}
