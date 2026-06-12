/**
 * RidesService — ride lifecycle business logic (Phase 3A + 3B + 3C).
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
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@prisma/prisma.service';
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
import { RedisService } from '@modules/redis/redis.service';
import { QUEUE_NAMES, JOB_NAMES, QUEUE_JOB_OPTIONS } from '@modules/queue/queue.constants';
import { RideEventsService } from '@modules/gateway/ride-events.service';
import { NotificationService } from '@modules/notifications/notification.service';
import { FareEngineService } from '@modules/pricing/fare-engine.service';
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

export interface DriverCurrentLocation {
  lat: string;
  lng: string;
  heading?: string;
  speed?: string;
  updatedAt: string;
  source: 'redis' | 'database';
}

export interface RideResponseData {
  id: string;
  status: RideStatus;
  pickup: RideLocation;
  destination: RideLocation;
  requestedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
  estimatedDistanceKm?: string;
  estimatedFare?: string;
  /** Populated for PASSENGER and ADMIN once a driver is assigned (Phase 4+) */
  driver?: RideDriverView;
  /** Populated for DRIVER and ADMIN */
  passengerName?: string;
  /** Current driver location from Redis (with PostgreSQL fallback) — REDIS_SCHEMA §2 */
  currentDriverLocation?: DriverCurrentLocation | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private readonly ridesRepository: RidesRepository,
    private readonly driversRepository: DriversRepository,
    private readonly redis: RedisService,
    private readonly rideEventsService: RideEventsService,
    private readonly notificationService: NotificationService,
    private readonly fareEngine: FareEngineService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.RIDE_MATCHING) private readonly rideMatchingQueue: Queue,
  ) {}

  /**
   * Create a new ride request.
   *
   * Flow (Phase 3C):
   *   1. Guard: reject if passenger already has an active ride
   *   2. INSERT ride at REQUESTED + transition to SEARCHING atomically
   *   3. Set ride:active cache + acquire ride:lock in Redis
   *   4. Enqueue match-ride job on ride-matching queue (with dedup key)
   *
   * API response returns status SEARCHING — REQUESTED is never surfaced.
   *
   * Source: docs/RBAC.md — POST /rides: PASSENGER only
   * Source: docs/RIDE_STATE_MACHINE.md §REQUESTED→SEARCHING
   * Source: docs/MATCHING_ENGINE.md §Step 1
   */
  async createRide(
    passengerId: string,
    dto: CreateRideDto,
  ): Promise<RideResponseData> {
    // Active-ride guard — MATCHING_ENGINE.md Step 1
    const existing = await this.ridesRepository.findActiveByPassengerId(passengerId);
    if (existing) {
      throw new ConflictException({
        message: 'You already have an active ride',
        code: 'RIDE_ALREADY_ACTIVE',
      });
    }

    // Estimate fare before persisting (Phase 5)
    const fareEstimate = this.fareEngine.estimate(
      dto.pickupLat, dto.pickupLng, dto.destLat, dto.destLng,
    );

    // DB: create at REQUESTED, then immediately transition to SEARCHING
    const created = await this.ridesRepository.create({
      passengerId,
      pickupLat: dto.pickupLat,
      pickupLng: dto.pickupLng,
      pickupAddress: dto.pickupAddress,
      destLat: dto.destLat,
      destLng: dto.destLng,
      destAddress: dto.destAddress,
      estimatedDistanceKm: fareEstimate.distanceKm,
      estimatedFare: fareEstimate.estimatedFare,
    });
    const ride = await this.ridesRepository.transitionToSearching(created.id);

    // Redis: set ride:active hash (24h TTL) + acquire ride:lock (30s)
    // Source: REDIS_SCHEMA.md §5, §6
    const now = new Date().toISOString();
    await this.redis.hset(this.redis.keys.rideActive(ride.id), {
      status: 'SEARCHING',
      passenger_id: passengerId,
      driver_id: '',
      pickup_lat: dto.pickupLat.toString(),
      pickup_lng: dto.pickupLng.toString(),
      dest_lat: dto.destLat.toString(),
      dest_lng: dto.destLng.toString(),
      created_at: now,
      updated_at: now,
    });
    await this.redis.expire(this.redis.keys.rideActive(ride.id), 86400);
    await this.redis.setNx(this.redis.keys.rideLock(ride.id), 'matching-engine', 30);

    // BullMQ: enqueue with dedup key (5s NX) to prevent duplicate jobs
    // Source: REDIS_SCHEMA.md §14, MATCHING_ENGINE.md §Job ID Convention
    const dedupKey = this.redis.keys.bullDedup(QUEUE_NAMES.RIDE_MATCHING, ride.id);
    const enqueued = await this.redis.setNx(dedupKey, ride.id, 5);
    if (enqueued) {
      await this.rideMatchingQueue.add(
        JOB_NAMES.MATCH_RIDE,
        {
          rideId: ride.id,
          passengerId,
          pickupLat: dto.pickupLat,
          pickupLng: dto.pickupLng,
          requestedAt: ride.requestedAt.toISOString(),
          attemptNumber: 1,
          excludeDriverIds: [],
        },
        {
          ...QUEUE_JOB_OPTIONS[QUEUE_NAMES.RIDE_MATCHING],
          jobId: `matching:${ride.id}:1`,
        },
      );
    }

    this.logger.log(`Ride created + searching: rideId=${ride.id} passengerId=${passengerId}`);

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
      estimatedDistanceKm: ride.estimatedDistanceKm?.toString(),
      estimatedFare: ride.estimatedFare?.toString(),
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

    const driverLocation = await this.fetchDriverLocation(ride.assignment?.driverId ?? null);
    return this.toResponseData(ride, callerRole, driverLocation);
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

    // Capture assignment before DB write (needed for ASSIGNED Redis cleanup)
    const preCancelStatus = ride.status;
    const assignedDriverId = ride.assignment?.driverId ?? null;

    const cancelled = await this.ridesRepository.cancelByPassenger(rideId, {
      rideId,
      cancelledBy: 'PASSENGER',
      reasonCode: dto.reasonCode,
      reasonText: dto.reasonText,
    });

    // Redis + BullMQ cleanup — side effects per RIDE_STATE_MACHINE.md
    if (preCancelStatus === RideStatus.SEARCHING) {
      await this.redis.del(this.redis.keys.rideActive(rideId));
      await this.redis.del(this.redis.keys.rideLock(rideId));
      const matchJob = await this.rideMatchingQueue.getJob(`matching:${rideId}:1`);
      await matchJob?.remove();
    } else if (preCancelStatus === RideStatus.ASSIGNED && assignedDriverId) {
      await this.redis.del(this.redis.keys.rideActive(rideId));
      await this.redis.del(this.redis.keys.driverLock(assignedDriverId));
      await this.redis.set(this.redis.keys.driverStatus(assignedDriverId), 'ONLINE', 60);
      const timeoutJob = await this.rideMatchingQueue.getJob(`acceptance-timeout:${rideId}`);
      await timeoutJob?.remove();
    } else if (preCancelStatus === RideStatus.ACCEPTED) {
      // driver:lock already released on accept; just clean up the active cache
      await this.redis.del(this.redis.keys.rideActive(rideId));
    }

    await this.rideEventsService.emitRideCancelled(
      rideId, passengerId, assignedDriverId, 'PASSENGER', cancelled.status,
    );
    if (assignedDriverId) {
      // Notify the driver that the passenger cancelled
      const driverUserId = await this.driversRepository.findUserIdByDriverId(assignedDriverId);
      if (driverUserId) void this.notificationService.createRideCancelled(driverUserId, rideId, 'PASSENGER');
    }
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

    // Dev endpoint: accept both REQUESTED and SEARCHING.
    // SEARCHING rides have a pending match job — cancel it before manual assignment.
    if (ride.status !== RideStatus.REQUESTED && ride.status !== RideStatus.SEARCHING) {
      throw new UnprocessableEntityException({
        message: `Cannot assign driver to ride in status '${ride.status}'`,
        code: 'RIDE_INVALID_TRANSITION',
      });
    }

    if (ride.status === RideStatus.SEARCHING) {
      const matchJob = await this.rideMatchingQueue.getJob(`matching:${ride.id}:1`);
      await matchJob?.remove();
      await this.redis.del(this.redis.keys.rideLock(rideId));
    }

    const { ride: updated, assignment } = await this.ridesRepository.assignDriver(rideId, driver.id);
    await this.driversRepository.updateStatus(driver.id, DriverStatus.BUSY);
    await this.redis.set(this.redis.keys.driverStatus(driver.id), 'BUSY', 60);

    this.logger.log(`Driver assigned (dev): rideId=${rideId} driverId=${driver.id}`);

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
   * Redis side effects (Phase 3C):
   *   - DEL ride:acceptance_deadline (cancels the countdown reference)
   *   - DEL driver:lock (driver is now committed, lock no longer needed)
   *   - HSET ride:active status=ACCEPTED
   *   - Remove acceptance-timeout BullMQ job
   *
   * Source: docs/RIDE_STATE_MACHINE.md — ASSIGNED → ACCEPTED
   * Source: docs/MATCHING_ENGINE.md §Step 7 — "If driver accepts"
   */
  async acceptRide(rideId: string, driverUserId: string): Promise<RideResponseData> {
    const { ride, driverId } = await this.requireDriverOwnership(rideId, driverUserId);

    if (ride.status !== RideStatus.ASSIGNED) {
      throw new UnprocessableEntityException({
        message: `Cannot accept ride in status '${ride.status}'`,
        code: 'RIDE_INVALID_TRANSITION',
      });
    }

    const updated = await this.ridesRepository.acceptRide(rideId, driverId);
    if (!updated) {
      throw new UnprocessableEntityException({
        message: 'Ride was already accepted by a concurrent request',
        code: 'RIDE_ALREADY_ACCEPTED',
      });
    }

    // Redis cleanup — RIDE_STATE_MACHINE.md §ASSIGNED→ACCEPTED
    await this.redis.del(this.redis.keys.rideAcceptanceDeadline(rideId));
    await this.redis.del(this.redis.keys.driverLock(driverId));
    await this.redis.hset(this.redis.keys.rideActive(rideId), {
      status: 'ACCEPTED',
      updated_at: new Date().toISOString(),
    });

    // Cancel the BullMQ acceptance-timeout job
    const timeoutJob = await this.rideMatchingQueue.getJob(`acceptance-timeout:${rideId}`);
    await timeoutJob?.remove();

    void this.rideEventsService.emitRideAccepted(rideId, ride.passengerId, driverId);
    void this.notificationService.createRideAccepted(ride.passengerId, rideId);
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
    this.rideEventsService.emitRideUpdated(rideId, ride.passengerId, driverId, 'ARRIVING');
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
    this.rideEventsService.emitRideUpdated(rideId, ride.passengerId, driverId, 'IN_PROGRESS');
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

    const { distanceKm, estimatedFare: fareAmount } = this.fareEngine.estimate(
      Number(ride.pickupLat), Number(ride.pickupLng),
      Number(ride.destLat), Number(ride.destLng),
    );
    const updated = await this.ridesRepository.completeRide(rideId, driverId, fareAmount, distanceKm);
    await this.driversRepository.updateStatus(driverId, DriverStatus.ONLINE);

    // Redis cleanup — RIDE_STATE_MACHINE.md §IN_PROGRESS→COMPLETED
    await this.redis.del(this.redis.keys.rideActive(rideId));
    await this.redis.set(this.redis.keys.driverStatus(driverId), 'ONLINE', 60);

    await this.rideEventsService.emitRideCompleted(rideId, ride.passengerId, driverId);
    void this.notificationService.createRideCompleted(ride.passengerId, driverUserId, rideId);
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

    // Redis cleanup — RIDE_STATE_MACHINE.md §ACCEPTED/ARRIVING→DRIVER_CANCELLED
    await this.redis.del(this.redis.keys.rideActive(rideId));
    await this.redis.set(this.redis.keys.driverStatus(driverId), 'ONLINE', 60);
    const newCount = await this.redis.incr(this.redis.keys.driverCancellationCount(driverId));
    if (newCount === 1) {
      await this.redis.expire(this.redis.keys.driverCancellationCount(driverId), 86400);
    }

    await this.rideEventsService.emitRideCancelled(
      rideId, ride.passengerId, driverId, 'DRIVER', updated.status,
    );
    void this.notificationService.createRideCancelled(ride.passengerId, rideId, 'DRIVER');
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
  private rideToResponse(ride: { id: string; status: RideStatus; pickupLat: any; pickupLng: any; pickupAddress: string | null; destLat: any; destLng: any; destAddress: string | null; estimatedDistanceKm?: any; estimatedFare?: any; requestedAt: Date; completedAt: Date | null; updatedAt: Date }): RideResponseData {
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
      estimatedDistanceKm: ride.estimatedDistanceKm?.toString(),
      estimatedFare: ride.estimatedFare?.toString(),
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
    currentDriverLocation?: DriverCurrentLocation | null,
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
      estimatedDistanceKm: ride.estimatedDistanceKm?.toString(),
      estimatedFare: ride.estimatedFare?.toString(),
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

    // Include current driver location for PASSENGER and ADMIN when a driver is assigned
    if ((isPassenger || isAdmin) && ride.assignment && currentDriverLocation !== undefined) {
      base.currentDriverLocation = currentDriverLocation;
    }

    return base;
  }

  /**
   * Fetch driver's current location from Redis first, fall back to PostgreSQL.
   * Returns null if no location data is available.
   *
   * Source: docs/REDIS_SCHEMA.md §2 — driver:location:{driverId}
   * Source: docs/REDIS_SCHEMA.md — Fallback: Query latest driver_locations row from PostgreSQL
   */
  private async fetchDriverLocation(driverId: string | null): Promise<DriverCurrentLocation | null> {
    if (!driverId) return null;

    // Try Redis first
    const hash = await this.redis.hgetall(this.redis.keys.driverLocation(driverId));
    if (hash?.lat && hash?.lng) {
      return {
        lat: hash.lat,
        lng: hash.lng,
        heading: hash.heading,
        speed: hash.speed,
        updatedAt: hash.updated_at ?? new Date().toISOString(),
        source: 'redis',
      };
    }

    // PostgreSQL fallback — REDIS_SCHEMA §2
    const row = await this.prisma.driverLocation.findUnique({ where: { driverId } });
    if (!row) return null;

    return {
      lat: row.latitude.toString(),
      lng: row.longitude.toString(),
      heading: row.heading?.toString(),
      speed: row.speed?.toString(),
      updatedAt: row.updatedAt.toISOString(),
      source: 'database',
    };
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
