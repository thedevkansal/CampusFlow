/**
 * DriversController — thin HTTP layer for driver endpoints.
 *
 * All routes require a valid JWT (JwtAuthGuard at class level).
 * DRIVER-only routes additionally enforce @Roles(Role.DRIVER) via RolesGuard.
 * GET /drivers/profile allows DRIVER and ADMIN (👑) — no @Roles restriction.
 *
 * Ownership is implicit: all operations use req.user.id.
 * No `:id` parameters — eliminates cross-driver access attack surface.
 *
 * Source: docs/API_CONTRACTS.md — Drivers section
 * Source: docs/RBAC.md — Driver Endpoints matrix
 * Source: docs/ENGINEERING_RULES.md — "No business logic in controllers"
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { DriversService, DriverProfileData } from './drivers.service';
import { RegisterDriverDto } from './dto/register-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { AuthenticatedUser, ApiSuccessResponse, Role } from '@common/types';
import { DriverStatus } from '@prisma/client';

@Controller('drivers')
@UseGuards(JwtAuthGuard)
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  /**
   * POST /api/v1/drivers/register
   *
   * DRIVER only. Creates a driver profile linked to the caller's user account.
   * PASSENGER → 403. Duplicate call → 409.
   *
   * Source: docs/RBAC.md — PASSENGER ❌ DRIVER ✅ ADMIN ❌
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard)
  @Roles(Role.DRIVER)
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDriverDto,
  ): Promise<ApiSuccessResponse<DriverProfileData>> {
    const data = await this.driversService.register(user.id, dto);
    return { success: true, data, message: 'Driver profile created successfully' };
  }

  /**
   * GET /api/v1/drivers/profile
   *
   * DRIVER (own profile) and ADMIN (own admin profile — returns 404 if not a driver).
   * PASSENGER → 403.
   *
   * Source: docs/RBAC.md — PASSENGER ❌ DRIVER 🔒 ADMIN 👑
   */
  @Get('profile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.DRIVER, Role.ADMIN)
  async getProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<DriverProfileData>> {
    const data = await this.driversService.getProfile(user.id);
    return { success: true, data, message: 'Driver profile retrieved successfully' };
  }

  /**
   * PATCH /api/v1/drivers/profile
   *
   * DRIVER only. Updates mutable vehicle fields.
   * ADMIN ❌ per RBAC.md.
   *
   * Source: docs/RBAC.md — PASSENGER ❌ DRIVER 🔒 ADMIN ❌
   */
  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.DRIVER)
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateDriverDto,
  ): Promise<ApiSuccessResponse<DriverProfileData>> {
    const data = await this.driversService.updateProfile(user.id, dto);
    return { success: true, data, message: 'Driver profile updated successfully' };
  }

  /**
   * POST /api/v1/drivers/online
   *
   * Marks the driver as ONLINE (available for ride matching).
   *
   * Source: docs/API_CONTRACTS.md — POST /drivers/online
   * Source: docs/RBAC.md — DRIVER 🔒 only
   */
  @Post('online')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.DRIVER)
  async goOnline(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<{ status: DriverStatus }>> {
    const data = await this.driversService.goOnline(user.id);
    return { success: true, data, message: 'You are now online' };
  }

  /**
   * POST /api/v1/drivers/offline
   *
   * Marks the driver as OFFLINE (unavailable for ride matching).
   *
   * Source: docs/API_CONTRACTS.md — POST /drivers/offline
   * Source: docs/RBAC.md — DRIVER 🔒 only
   */
  @Post('offline')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.DRIVER)
  async goOffline(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<{ status: DriverStatus }>> {
    const data = await this.driversService.goOffline(user.id);
    return { success: true, data, message: 'You are now offline' };
  }

  /**
   * PATCH /api/v1/drivers/location
   *
   * Updates the driver's real-time GPS coordinates.
   * Rate limited: 120 requests / 60s per driver (enforced in DriversService).
   * Driver must be ONLINE — enforced in service.
   *
   * Source: docs/API_CONTRACTS.md — PATCH /drivers/location
   * Source: docs/RBAC.md — DRIVER 🔒, rate limited 120/min
   */
  @Patch('location')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.DRIVER)
  async updateLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateLocationDto,
  ): Promise<ApiSuccessResponse<{ latitude: string; longitude: string; updatedAt: Date }>> {
    const data = await this.driversService.updateLocation(user.id, dto);
    return { success: true, data, message: 'Location updated successfully' };
  }
}
