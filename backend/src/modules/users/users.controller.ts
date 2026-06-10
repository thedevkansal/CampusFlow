/**
 * UsersController — thin HTTP layer for user profile endpoints.
 *
 * GET  /api/v1/users/me — all authenticated roles (PASSENGER, DRIVER, ADMIN)
 * PATCH /api/v1/users/me — PASSENGER and DRIVER only (ADMIN ❌ per RBAC.md)
 *
 * Ownership is implicit: both endpoints operate on req.user.id.
 * JwtAuthGuard is applied at class level — all routes require a valid token.
 * RolesGuard is applied per-handler only where role restriction is required.
 *
 * Source: docs/RBAC.md — User Endpoints matrix
 * Source: docs/ENGINEERING_RULES.md — "No business logic in controllers"
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UsersService, UserProfileData } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { AuthenticatedUser, ApiSuccessResponse, Role } from '@common/types';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /api/v1/users/me
   *
   * Returns the authenticated caller's own profile.
   * All roles allowed — ownership is inherent (always own profile).
   *
   * Source: docs/RBAC.md — PASSENGER 🔒 DRIVER 🔒 ADMIN 👑
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<UserProfileData>> {
    const data = await this.usersService.getProfile(user.id);

    return {
      success: true,
      data,
      message: 'Profile retrieved successfully',
    };
  }

  /**
   * PATCH /api/v1/users/me
   *
   * Updates the authenticated caller's own profile (name only).
   * ADMIN role is explicitly blocked per RBAC.md.
   *
   * Source: docs/RBAC.md — PASSENGER 🔒 DRIVER 🔒 ADMIN ❌
   */
  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.PASSENGER, Role.DRIVER)
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserDto,
  ): Promise<ApiSuccessResponse<UserProfileData>> {
    const data = await this.usersService.updateProfile(user.id, dto);

    return {
      success: true,
      data,
      message: 'Profile updated successfully',
    };
  }
}
