/**
 * RidesService — ride lifecycle business logic (Phase 3A + 3B).
 *
 * Ownership enforcement:
 *   - PASSENGER: passengerId from JWT sub matches ride.passengerId (DB verified)
 *   - DRIVER: ride_assignments.driverId matched against DriversRepository.findByUserId()
 *             driverId is NEVER read from JWT for authorization decisions.
 *   - ADMIN: no ownership check
 *
 * Source: docs/RBAC.md — Ride Endpoints matrix
 * Source: docs/RIDE_STATE_MACHINE.md — Valid Transitions, Forbidden Transitions
 * Source: docs/ENGINEERING_RULES.md — "No business logic in controllers"
 */

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RideStatus, DriverStatus } from '@prisma/client';
import {
  DRIVER_CANCELLABLE_STATUSES,
  PASSENGER_CANCELLABLE_STATUSES,
  RidesRepository,
  RideWithRelations,
} from './rides.repository';
import { CreateRideDto } from './dto/create-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { CancelDriverDto } from './dto/cancel-driver.dto';
import { DriversRepository } from '@modules/drivers/drivers.repository';
import { Role } from '@common/types';

// ─── Response Types ───────────────────────────────────────────────────────────

export interface RideLocation {
  lat: string;
  lng: string;
  address: string | null;
}

export interface RideDriverView {
  driverId: string;
  name: string;
  vehicleNumber: string;
  vehicleModel: string | null;
  vehicleColor: string | null;
  rating: string;
  acceptedAt: Date | null;
}

export interface RideResponseData {
  id: string;
  status: RideStatus;
  pickup: RideLocation;
  destination: RideLocation;
  requestedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
  /** Populated for PASSENGER and ADMIN once a driver is assigned (Phase 4+) */
  driver?: RideDriverView;
  /** Populated for DRIVER and ADMIN */
  passengerName?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private readonly ridesRepository: RidesRepository,
    private readonly driversRepository: DriversRepository,
  ) {}

  /**
   * Create a new ride request.
   *
   * Ride is created with status REQUESTED. No state transition occurs until
   * the MatchingModule (Phase 4) picks it up via BullMQ.
   *
   * Source: docs/RBAC.md — POST /rides: PASSENGER only
   * Source: docs/RIDE_STATE_MACHINE.md — initial state REQUESTED
   */
  async createRide(
    passengerId: string,
    dto: CreateRideDto,
  ): Promise<RideResponseData> {
    const ride = await this.ridesRepository.create({
      passengerId,
      pickupLat: dto.pickupLat,
      pickupLng: dto.pickupLng,
      pickupAddress: dto.pickupAddress,
      destLat: dto.destLat,
      destLng: dto.destLng,
      destAddress: dto.destAddress,
    });

    this.logger.log(`Ride created: rideId=${ride.id} passengerId=${passengerId}`);

    return {
      id: ride.id,
      status: ride.status,
      pickup: {
        lat: ride.pickupLat.toString(),
        lng: ride.pickupLng.toString(),
        address: ride.pickupAddress,
      },
      destination: {
        lat: ride.destLat.toString(),
        lng: ride.destLng.toString(),
        address: ride.destAddress,
      },
      requestedAt: ride.requestedAt,
      completedAt: ride.completedAt,
      updatedAt: ride.updatedAt,
    };
  }

  /**
   * List all rides for the authenticated passenger.
   *
   * Source: docs/RBAC.md — GET /rides: PASSENGER 🔒 (own rides), ADMIN 👑
   */
  async listRides(
    callerId: string,
    callerRole: Role,
  ): Promise<RideResponseData[]> {
    // ADMIN on GET /rides — not in Phase 3A scope (deferred to AdminModule)
    // Only PASSENGER path is implemented here
    if (callerRole !== Role.PASSENGER) {
      throw new ForbiddenException({
        message: 'Only passengers can list rides via this endpoint',
        code: 'AUTHZ_ROLE_FORBIDDEN',
      });
    }

    const rides = await this.ridesRepository.findByPassengerId(callerId);
    return rides.map((r) => this.toResponseData(r, callerRole));
  }

  /**
   * Return the passenger's current active ride.
   * Returns 404 if the passenger has no active ride.
   *
   * Source: docs/RBAC.md — GET /rides/active: PASSENGER 🔒
   */
  async getActiveRide(passengerId: string): Promise<RideResponseData> {
    const ride = await this.ridesRepository.findActiveByPassengerId(passengerId);

    if (!ride) {
      throw new NotFoundException({
        message: 'No active ride found',
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    return this.toResponseData(ride, Role.PASSENGER);
  }

  /**
   * Get a ride by ID with role-specific field shaping.
   *
   * Ownership enforcement (DB is source of truth — no JWT driverId used):
   *   - PASSENGER: ride.passengerId must match callerId
   *   - DRIVER: ride_assignments.driverId must match caller's driver record (Phase 4+)
   *             In Phase 3A, no assignments exist → DRIVER gets 403
   *   - ADMIN: no ownership check
   *
   * Source: docs/RBAC.md — GET /rides/:id + Field-Level Restrictions
   */
  async getRideById(
    rideId: string,
    callerId: string,
    callerRole: Role,
  ): Promise<RideResponseData> {
    const ride = await this.ridesRepository.findById(rideId);

    if (!ride) {
      throw new NotFoundException({
        message: 'Ride not found',
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    // Ownership enforcement per RBAC.md — DB is source of truth
    if (callerRole === Role.PASSENGER) {
      if (ride.passengerId !== callerId) {
        throw new ForbiddenException({
          message: 'You do not have access to this ride',
          code: 'AUTHZ_OWNERSHIP_DENIED',
        });
      }
    } else if (callerRole === Role.DRIVER) {
      // DB is source of truth — resolve actual driverId, never trust JWT
      const driverId = await this.resolveDriverId(callerId);
      const isAssignedDriver =
        driverId !== null &&
        ride.assignment !== null &&
        ride.assignment.driverId === driverId;

      if (!isAssignedDriver) {
        throw new ForbiddenException({
          message: 'You are not the assigned driver for this ride',
          code: 'AUTHZ_OWNERSHIP_DENIED',
        });
      }
    }
    // ADMIN: no ownership check

    return this.toResponseData(ride, callerRole);
  }

  /**
   * Passenger cancels their own ride.
   *
   * Valid from: REQUESTED, SEARCHING, ASSIGNED, ACCEPTED
   * (Phase 3A rides only reach REQUESTED — other states listed for future correctness)
   *
   * Per state machine: forbidden transitions must return 422.
   *
   * Source: docs/RIDE_STATE_MACHINE.md — Passenger cancellation policy table
   * Source: docs/RBAC.md — POST /rides/:id/cancel: PASSENGER 🔒
   */
  async cancelRide(
    rideId: string,
    passengerId: string,
    dto: CancelRideDto,
  ): Promise<RideResponseData> {
    const ride = await this.ridesRepository.findById(rideId);

    if (!ride) {
      throw new NotFoundException({
        message: 'Ride not found',
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    // Ownership check — passenger can only cancel their own ride
    if (ride.passengerId !== passengerId) {
      throw new ForbiddenException({
        message: 'You do not have access to this ride',
        code: 'AUTHZ_OWNERSHIP_DENIED',
      });
    }

    // State machine: only specific states are cancellable
    if (!PASSENGER_CANCELLABLE_STATUSES.includes(ride.status)) {
      throw new UnprocessableEntityException({
        message: `Ride cannot be cancelled from status '${ride.status}'`,
        code: 'RIDE_INVALID_TRANSITION',
      });
    }

    const cancelled = await this.ridesRepository.cancelByPassenger(rideId, {
      rideId,
      cancelledBy: 'PASSENGER',
      reasonCode: dto.reasonCode,
      reasonText: dto.reasonText,
    });

    this.logger.log(
      `Ride cancelled by passenger: rideId=${rideId} passengerId=${passengerId} reason=${dto.reasonCode}`,
    );

    return {
      id: cancelled.id,
      status: cancelled.status,
      pickup: {
        lat: cancelled.pickupLat.toString(),
        lng: cancelled.pickupLng.toString(),
        address: cancelled.pickupAddress,
      },
      destination: {
        lat: cancelled.destLat.toString(),
        lng: cancelled.destLng.toString(),
        address: cancelled.destAddress,
      },
      requestedAt: cancelled.requestedAt,
      completedAt: cancelled.completedAt,
      updatedAt: cancelled.updatedAt,
    };
  }

  // ─── Phase 3B: Assignment & Driver Lifecycle ──────────────────────────────

  /**
   * Manually assign a DRIVER to a REQUESTED ride.
   * Acts as a temporary stand-in for the MatchingModule (Phase 4).
   *
   * Flow:
   *   1. Resolve driver record from DB (userId → Driver)
   *   2. Verify ride is REQUESTED
   *   3. Create RideAssignment + update ride status
   *   4. Set driver.status = BUSY
   *
   * Source: docs/RIDE_STATE_MACHINE.md — REQUESTED → ASSIGNED
   */
  async assignDriver(
    rideId: string,
    driverUserId: string,
  ): Promise<{ assignmentId: string; rideId: string; driverId: string; status: RideStatus }> {
    const driver = await this.driversRepository.findByUserId(driverUserId);
    if (!driver) {
      throw new NotFoundException({
        message: 'Driver profile not found',
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) {
      throw new NotFoundException({ message: 'Ride not found', code: 'RESOURCE_NOT_FOUND' });
    }

    if (ride.status !== RideStatus.REQUESTED) {
      throw new UnprocessableEntityException({
        message: `Cannot assign driver to ride in status '${ride.status}'`,
        code: 'RIDE_INVALID_TRANSITION',
      });
    }

    const { ride: updated, assignment } = await this.ridesRepository.assignDriver(rideId, driver.id);
    await this.driversRepository.updateStatus(driver.id, DriverStatus.BUSY);

    this.logger.log(`Driver assigned: rideId=${rideId} driverId=${driver.id}`);

    return {
      assignmentId: assignment.id,
      rideId: updated.id,
      driverId: driver.id,
      status: updated.status,
    };
  }

  /**
   * Driver accepts an assigned ride (ASSIGNED → ACCEPTED).
   * Ownership: DB lookup, not JWT.
   *
   * Source: docs/RIDE_STATE_MACHINE.md — ASSIGNED → ACCEPTED
   */
  async acceptRide(rideId: string, driverUserId: string): Promise<RideResponseData> {
    const { ride, driverId } = await this.requireDriverOwnership(rideId, driverUserId);

    if (ride.status !== RideStatus.ASSIGNED) {
      throw new UnprocessableEntityException({
        message: `Cannot accept ride in status '${ride.status}'`,
        code: 'RIDE_INVALID_TRANSITION',
      });
    }

    const updated = await this.ridesRepository.acceptRide(rideId);
    this.logger.log(`Ride accepted: rideId=${rideId} driverId=${driverId}`);
    return this.rideToResponse(updated);
  }

  /**
   * Driver signals arrival at pickup (ACCEPTED → ARRIVING).
   *
   * Source: docs/RIDE_STATE_MACHINE.md — ACCEPTED → ARRIVING
   */
  async arriveRide(rideId: string, driverUserId: string): Promise<RideResponseData> {
    const { ride, driverId } = await this.requireDriverOwnership(rideId, driverUserId);

    if (ride.status !== RideStatus.ACCEPTED) {
      throw new UnprocessableEntityException({
        message: `Cannot mark arriving for ride in status '${ride.status}'`,
        code: 'RIDE_INVALID_TRANSITION',
      });
    }

    const updated = await this.ridesRepository.arriveRide(rideId);
    this.logger.log(`Driver arriving: rideId=${rideId} driverId=${driverId}`);
    return this.rideToResponse(updated);
  }

  /**
   * Driver starts the ride (ARRIVING → IN_PROGRESS).
   *
   * Source: docs/RIDE_STATE_MACHINE.md — ARRIVING → IN_PROGRESS
   */
  async startRide(rideId: string, driverUserId: string): Promise<RideResponseData> {
    const { ride, driverId } = await this.requireDriverOwnership(rideId, driverUserId);

    if (ride.status !== RideStatus.ARRIVING) {
      throw new UnprocessableEntityException({
        message: `Cannot start ride in status '${ride.status}'`,
        code: 'RIDE_INVALID_TRANSITION',
      });
    }

    const updated = await this.ridesRepository.startRide(rideId);
    this.logger.log(`Ride started: rideId=${rideId} driverId=${driverId}`);
    return this.rideToResponse(updated);
  }

  /**
   * Driver completes the ride (IN_PROGRESS → COMPLETED).
   * Creates RideFare + DriverEarning records.
   * Resets driver status to ONLINE.
   *
   * Source: docs/RIDE_STATE_MACHINE.md — IN_PROGRESS → COMPLETED
   */
  async completeRide(rideId: string, driverUserId: string): Promise<RideResponseData> {
    const { ride, driverId } = await this.requireDriverOwnership(rideId, driverUserId);

    if (ride.status !== RideStatus.IN_PROGRESS) {
      throw new UnprocessableEntityException({
        message: `Cannot complete ride in status '${ride.status}'`,
        code: 'RIDE_INVALID_TRANSITION',
      });
    }

    const updated = await this.ridesRepository.completeRide(rideId, driverId, ride);
    await this.driversRepository.updateStatus(driverId, DriverStatus.ONLINE);

    this.logger.log(`Ride completed: rideId=${rideId} driverId=${driverId}`);
    return this.rideToResponse(updated);
  }

  /**
   * Driver cancels an assigned ride (ASSIGNED/ACCEPTED/ARRIVING → DRIVER_CANCELLED).
   * Resets driver status to ONLINE.
   *
   * Source: docs/RIDE_STATE_MACHINE.md — ACCEPTED/ARRIVING → DRIVER_CANCELLED
   */
  async cancelByDriver(
    rideId: string,
    driverUserId: string,
    dto: CancelDriverDto,
  ): Promise<RideResponseData> {
    const { ride, driverId } = await this.requireDriverOwnership(rideId, driverUserId);

    if (!DRIVER_CANCELLABLE_STATUSES.includes(ride.status)) {
      throw new UnprocessableEntityException({
        message: `Driver cannot cancel ride in status '${ride.status}'`,
        code: 'RIDE_INVALID_TRANSITION',
      });
    }

    const updated = await this.ridesRepository.cancelByDriver(
      rideId, driverId, dto.reasonCode, dto.reasonText,
    );
    await this.driversRepository.updateStatus(driverId, DriverStatus.ONLINE);

    this.logger.log(`Ride cancelled by driver: rideId=${rideId} driverId=${driverId} reason=${dto.reasonCode}`);
    return this.rideToResponse(updated);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Resolve + verify driver ownership of a ride.
   * Returns the ride and the driver's real DB id.
   * Throws 404 if ride/driver not found, 403 if not the assigned driver.
   */
  private async requireDriverOwnership(
    rideId: string,
    driverUserId: string,
  ): Promise<{ ride: NonNullable<Awaited<ReturnType<RidesRepository['findById']>>>; driverId: string }> {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) {
      throw new NotFoundException({ message: 'Ride not found', code: 'RESOURCE_NOT_FOUND' });
    }

    const driverId = await this.resolveDriverId(driverUserId);
    if (!driverId || !ride.assignment || ride.assignment.driverId !== driverId) {
      throw new ForbiddenException({
        message: 'You are not the assigned driver for this ride',
        code: 'AUTHZ_OWNERSHIP_DENIED',
      });
    }

    return { ride, driverId };
  }

  /**
   * Convert a Ride (without relations) to RideResponseData.
   * Used for driver lifecycle responses where relation data is not needed.
   */
  private rideToResponse(ride: { id: string; status: RideStatus; pickupLat: any; pickupLng: any; pickupAddress: string | null; destLat: any; destLng: any; destAddress: string | null; requestedAt: Date; completedAt: Date | null; updatedAt: Date }): RideResponseData {
    return {
      id: ride.id,
      status: ride.status,
      pickup: {
        lat: ride.pickupLat.toString(),
        lng: ride.pickupLng.toString(),
        address: ride.pickupAddress,
      },
      destination: {
        lat: ride.destLat.toString(),
        lng: ride.destLng.toString(),
        address: ride.destAddress,
      },
      requestedAt: ride.requestedAt,
      completedAt: ride.completedAt,
      updatedAt: ride.updatedAt,
    };
  }

  /**
   * Shape ride DB record into role-aware response.
   *
   * Source: docs/RBAC.md — Field-Level Restrictions:
   *   PASSENGER sees: driver name/vehicle/rating (when assigned)
   *   DRIVER sees:    passenger name
   *   ADMIN sees:     all fields
   */
  private toResponseData(
    ride: RideWithRelations,
    callerRole: Role,
  ): RideResponseData {
    const base: RideResponseData = {
      id: ride.id,
      status: ride.status,
      pickup: {
        lat: ride.pickupLat.toString(),
        lng: ride.pickupLng.toString(),
        address: ride.pickupAddress,
      },
      destination: {
        lat: ride.destLat.toString(),
        lng: ride.destLng.toString(),
        address: ride.destAddress,
      },
      requestedAt: ride.requestedAt,
      completedAt: ride.completedAt,
      updatedAt: ride.updatedAt,
    };

    const isPassenger = callerRole === Role.PASSENGER;
    const isDriver = callerRole === Role.DRIVER;
    const isAdmin = callerRole === Role.ADMIN;

    // PASSENGER and ADMIN see driver details (when assigned)
    if ((isPassenger || isAdmin) && ride.assignment) {
      base.driver = {
        driverId: ride.assignment.driverId,
        name: ride.assignment.driver.user.name,
        vehicleNumber: ride.assignment.driver.vehicleNumber,
        vehicleModel: ride.assignment.driver.vehicleModel,
        vehicleColor: ride.assignment.driver.vehicleColor,
        rating: ride.assignment.driver.rating.toString(),
        acceptedAt: ride.assignment.acceptedAt,
      };
    }

    // DRIVER and ADMIN see passenger name
    if (isDriver || isAdmin) {
      base.passengerName = ride.passenger.name;
    }

    return base;
  }

  /**
   * Resolve a user's driverId from the database.
   * JWT driverId is NEVER used for authorization decisions.
   *
   * Source: Phase 3B design — DB is source of truth for driver ownership
   */
  private async resolveDriverId(userId: string): Promise<string | null> {
    const driver = await this.driversRepository.findByUserId(userId);
    return driver?.id ?? null;
  }
}
