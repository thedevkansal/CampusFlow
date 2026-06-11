/**
 * RidesService — ride lifecycle business logic for Phase 3A.
 *
 * Phase 3A scope:
 *   - Create ride (stays REQUESTED — no matching worker yet)
 *   - List passenger's own rides
 *   - Get active ride
 *   - Get ride by ID (role-specific field shaping)
 *   - Passenger cancel (REQUESTED → PASSENGER_CANCELLED only)
 *
 * Matching, assignment, acceptance, start, completion, fare, earnings,
 * and BullMQ orchestration are deferred to Phase 4 (MatchingModule).
 *
 * Ownership enforcement:
 *   - PASSENGER: passengerId from JWT sub matches ride.passengerId (DB verified)
 *   - DRIVER: must be the assigned driver — validated via ride_assignments (Phase 4)
 *   - ADMIN: no ownership check
 *   - driverId is NOT read from JWT for authorization decisions. DB is source of truth.
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
import { RideStatus } from '@prisma/client';
import {
  PASSENGER_CANCELLABLE_STATUSES,
  RidesRepository,
  RideWithRelations,
} from './rides.repository';
import { CreateRideDto } from './dto/create-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
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

  constructor(private readonly ridesRepository: RidesRepository) {}

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
      // Phase 3A: no assignments exist. A DRIVER cannot own any ride.
      // Assignment ownership check is implemented in Phase 4 (MatchingModule).
      const isAssignedDriver =
        ride.assignment !== null &&
        ride.assignment.driverId === (await this.resolveDriverId(callerId));

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

  // ─── Private Helpers ─────────────────────────────────────────────────────────

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
   * Resolve a user's driverId from DB.
   * Used for DRIVER ownership checks — JWT driverId is NOT trusted for authorization.
   *
   * Phase 4 will inject DriversRepository directly. For Phase 3A, DRIVER ownership
   * always returns null (no assignments exist), so 403 is the correct response.
   *
   * Source: Phase 3A design decision — DB is source of truth for driver ownership
   */
  private async resolveDriverId(_userId: string): Promise<string | null> {
    // Phase 4: inject DriversRepository and call findByUserId(userId)
    // Phase 3A: no assignments exist, DRIVER cannot own any ride
    return null;
  }
}
