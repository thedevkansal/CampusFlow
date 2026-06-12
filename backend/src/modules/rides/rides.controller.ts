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
import { CancelDriverDto } from './dto/cancel-driver.dto';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { DevOnlyGuard } from '@common/guards/dev-only.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { AuthenticatedUser, ApiSuccessResponse, Role } from '@common/types';
import { RideStatus } from '@prisma/client';

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
   * GET /api/v1/rides/driver-active
   *
   * Returns the driver's current non-terminal assigned ride.
   * 404 if none exists.
   *
   * IMPORTANT: Must be declared BEFORE /rides/:id to avoid 'driver-active' being parsed as a UUID.
   *
   * Source: docs/RBAC.md — DRIVER 🔒 only
   */
  @Get('driver-active')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.DRIVER)
  async getActiveRideForDriver(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<RideResponseData>> {
    const data = await this.ridesService.getActiveRideForDriver(user.id);
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

  // ─── Phase 3B: Driver Lifecycle ──────────────────────────────────────────

  /**
   * POST /api/v1/rides/:id/assign
   *
   * Temporary manual assignment — stand-in for MatchingModule (Phase 4).
   * DRIVER only. Driver self-assigns to a REQUESTED ride.
   */
  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DevOnlyGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async assignDriver(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<{ assignmentId: string; rideId: string; driverId: string; status: RideStatus }>> {
    const data = await this.ridesService.assignDriver(id, user.id);
    return { success: true, data, message: 'Driver assigned successfully' };
  }

  /**
   * POST /api/v1/rides/:id/accept
   *
   * Driver accepts an ASSIGNED ride → ACCEPTED.
   */
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.DRIVER)
  async acceptRide(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<RideResponseData>> {
    const data = await this.ridesService.acceptRide(id, user.id);
    return { success: true, data, message: 'Ride accepted' };
  }

  /**
   * POST /api/v1/rides/:id/arrive
   *
   * Driver signals arrival at pickup → ARRIVING.
   */
  @Post(':id/arrive')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.DRIVER)
  async arriveRide(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<RideResponseData>> {
    const data = await this.ridesService.arriveRide(id, user.id);
    return { success: true, data, message: 'Driver arriving at pickup' };
  }

  /**
   * POST /api/v1/rides/:id/start
   *
   * Driver starts the ride → IN_PROGRESS.
   */
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.DRIVER)
  async startRide(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<RideResponseData>> {
    const data = await this.ridesService.startRide(id, user.id);
    return { success: true, data, message: 'Ride started' };
  }

  /**
   * POST /api/v1/rides/:id/complete
   *
   * Driver completes the ride → COMPLETED. Creates fare and earnings records.
   */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.DRIVER)
  async completeRide(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<RideResponseData>> {
    const data = await this.ridesService.completeRide(id, user.id);
    return { success: true, data, message: 'Ride completed' };
  }

  /**
   * POST /api/v1/rides/:id/cancel-driver
   *
   * Driver cancels from ASSIGNED/ACCEPTED/ARRIVING → DRIVER_CANCELLED.
   * Resets driver to ONLINE.
   */
  @Post(':id/cancel-driver')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.DRIVER)
  async cancelByDriver(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CancelDriverDto,
  ): Promise<ApiSuccessResponse<RideResponseData>> {
    const data = await this.ridesService.cancelByDriver(id, user.id, dto);
    return { success: true, data, message: 'Ride cancelled by driver' };
  }
}
