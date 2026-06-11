/**
 * RidesController — thin HTTP layer for ride endpoints (Phase 3A).
 *
 * Routes implemented:
 *   POST   /rides            — create ride (PASSENGER only)
 *   GET    /rides            — list own rides (PASSENGER only in Phase 3A)
 *   GET    /rides/active     — current active ride (PASSENGER only)
 *   GET    /rides/:id        — ride detail (PASSENGER 🔒, DRIVER 🔒, ADMIN 👑)
 *   POST   /rides/:id/cancel — cancel ride (PASSENGER only)
 *
 * JwtAuthGuard applied at class level — all routes require authentication.
 * Per-route @Roles() used only where role restriction is required.
 *
 * Source: docs/API_CONTRACTS.md — Rides section
 * Source: docs/RBAC.md — Ride Endpoints matrix
 * Source: docs/ENGINEERING_RULES.md — "No business logic in controllers"
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RidesService, RideResponseData } from './rides.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { AuthenticatedUser, ApiSuccessResponse, Role } from '@common/types';

@Controller('rides')
@UseGuards(JwtAuthGuard)
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  /**
   * POST /api/v1/rides
   *
   * PASSENGER only — creates a ride request at status REQUESTED.
   *
   * Source: docs/RBAC.md — PASSENGER ✅ DRIVER ❌ ADMIN ❌
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard)
  @Roles(Role.PASSENGER)
  async createRide(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRideDto,
  ): Promise<ApiSuccessResponse<RideResponseData>> {
    const data = await this.ridesService.createRide(user.id, dto);
    return { success: true, data, message: 'Ride request created successfully' };
  }

  /**
   * GET /api/v1/rides
   *
   * Returns the authenticated passenger's own ride history.
   * ADMIN list is deferred to AdminModule.
   *
   * Source: docs/RBAC.md — PASSENGER 🔒, ADMIN 👑 (Admin deferred)
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.PASSENGER)
  async listRides(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<RideResponseData[]>> {
    const data = await this.ridesService.listRides(user.id, user.role as Role);
    return { success: true, data, message: 'Rides retrieved successfully' };
  }

  /**
   * GET /api/v1/rides/active
   *
   * Returns the passenger's current non-terminal ride.
   * 404 if none exists.
   *
   * IMPORTANT: This route must be declared BEFORE /rides/:id to prevent
   * the string 'active' from being parsed as a UUID param.
   *
   * Source: docs/RBAC.md — PASSENGER 🔒 only
   */
  @Get('active')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.PASSENGER)
  async getActiveRide(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<RideResponseData>> {
    const data = await this.ridesService.getActiveRide(user.id);
    return { success: true, data, message: 'Active ride retrieved successfully' };
  }

  /**
   * GET /api/v1/rides/:id
   *
   * Role-specific response shaping:
   *   PASSENGER — sees driver details when assigned
   *   DRIVER    — sees passenger name; must be assigned driver
   *   ADMIN     — sees all fields
   *
   * Source: docs/RBAC.md — PASSENGER 🔒 DRIVER 🔒 ADMIN 👑 + Field-Level Restrictions
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getRideById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<RideResponseData>> {
    const data = await this.ridesService.getRideById(id, user.id, user.role as Role);
    return { success: true, data, message: 'Ride retrieved successfully' };
  }

  /**
   * POST /api/v1/rides/:id/cancel
   *
   * Passenger cancels their own ride.
   * Returns 422 if the ride is in a non-cancellable state.
   *
   * Source: docs/RBAC.md — PASSENGER 🔒 only
   * Source: docs/RIDE_STATE_MACHINE.md — Cancellation Policy
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.PASSENGER)
  async cancelRide(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CancelRideDto,
  ): Promise<ApiSuccessResponse<RideResponseData>> {
    const data = await this.ridesService.cancelRide(id, user.id, dto);
    return { success: true, data, message: 'Ride cancelled successfully' };
  }
}
