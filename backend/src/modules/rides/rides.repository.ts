/**
 * RidesRepository — data access layer for Ride, RideEvent, and CancellationReason records.
 *
 * All ride-related database queries are isolated here.
 * No business logic. No state machine decisions.
 *
 * Source: docs/ENGINEERING_RULES.md — "Repository pattern. Service layer abstraction."
 * Source: schema.prisma — Ride, RideEvent, CancellationReason models
 * Source: docs/RIDE_STATE_MACHINE.md — "All ride_events entries are immutable"
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import {
  CancelledBy,
  Ride,
  RideAssignment,
  RideEvent,
  RideEventType,
  RideStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';

export interface CreateRideInput {
  passengerId: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress?: string;
  destLat: number;
  destLng: number;
  destAddress?: string;
}

export interface CreateCancellationInput {
  rideId: string;
  cancelledBy: CancelledBy;
  reasonCode: string;
  reasonText?: string;
}

/** Shape returned for list and detail responses */
export type RideWithRelations = Ride & {
  assignment: {
    driverId: string;
    acceptedAt: Date | null;
    driver: {
      vehicleNumber: string;
      vehicleModel: string | null;
      vehicleColor: string | null;
      /** Prisma returns Decimal — serialised to string in service layer */
      rating: Prisma.Decimal;
      user: { name: string };
    };
  } | null;
  passenger: { name: string };
};

/** States from which a driver is permitted to cancel */
export const DRIVER_CANCELLABLE_STATUSES: RideStatus[] = [
  RideStatus.ASSIGNED,
  RideStatus.ACCEPTED,
  RideStatus.ARRIVING,
];

/** Fare constants — no external pricing engine in Phase 3B */
const BASE_FARE = 50;
const PER_KM_RATE = 12;

/** Haversine distance in km between two lat/lng points */
function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const ACTIVE_STATUSES: RideStatus[] = [
  RideStatus.REQUESTED,
  RideStatus.SEARCHING,
  RideStatus.ASSIGNED,
  RideStatus.ACCEPTED,
  RideStatus.ARRIVING,
  RideStatus.IN_PROGRESS,
];

/** States from which a passenger is permitted to cancel */
export const PASSENGER_CANCELLABLE_STATUSES: RideStatus[] = [
  RideStatus.REQUESTED,
  RideStatus.SEARCHING,
  RideStatus.ASSIGNED,
  RideStatus.ACCEPTED,
];

@Injectable()
export class RidesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new Ride record with status REQUESTED.
   * Also inserts the initial REQUESTED RideEvent atomically via Prisma nested write.
   *
   * Source: docs/RIDE_STATE_MACHINE.md — "REQUESTED: Passenger has submitted a ride request"
   */
  async create(data: CreateRideInput): Promise<Ride> {
    return this.prisma.ride.create({
      data: {
        passengerId: data.passengerId,
        pickupLat: data.pickupLat,
        pickupLng: data.pickupLng,
        pickupAddress: data.pickupAddress,
        destLat: data.destLat,
        destLng: data.destLng,
        destAddress: data.destAddress,
        status: RideStatus.REQUESTED,
        // Insert immutable event log entry atomically
        events: {
          create: {
            eventType: RideEventType.REQUESTED,
          },
        },
      },
    });
  }

  /**
   * Find a ride by ID with its assignment (if any) and passenger name.
   */
  async findById(id: string): Promise<RideWithRelations | null> {
    return this.prisma.ride.findUnique({
      where: { id },
      include: {
        passenger: { select: { name: true } },
        assignment: {
          select: {
            driverId: true,
            acceptedAt: true,
            driver: {
              select: {
                vehicleNumber: true,
                vehicleModel: true,
                vehicleColor: true,
                rating: true,
                user: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  }

  /**
   * List all rides belonging to a passenger, ordered by most recent first.
   * Used for GET /rides (passenger's own history).
   */
  async findByPassengerId(passengerId: string): Promise<RideWithRelations[]> {
    return this.prisma.ride.findMany({
      where: { passengerId },
      orderBy: { requestedAt: 'desc' },
      include: {
        passenger: { select: { name: true } },
        assignment: {
          select: {
            driverId: true,
            acceptedAt: true,
            driver: {
              select: {
                vehicleNumber: true,
                vehicleModel: true,
                vehicleColor: true,
                rating: true,
                user: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Find a passenger's current active ride (non-terminal status).
   * Returns null if the passenger has no active ride.
   *
   * Source: docs/RBAC.md — GET /rides/active: PASSENGER 🔒 own active ride
   */
  async findActiveByPassengerId(
    passengerId: string,
  ): Promise<RideWithRelations | null> {
    return this.prisma.ride.findFirst({
      where: {
        passengerId,
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: { requestedAt: 'desc' },
      include: {
        passenger: { select: { name: true } },
        assignment: {
          select: {
            driverId: true,
            acceptedAt: true,
            driver: {
              select: {
                vehicleNumber: true,
                vehicleModel: true,
                vehicleColor: true,
                rating: true,
                user: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Transition a ride to PASSENGER_CANCELLED.
   * Atomically:
   *   1. Updates rides.status
   *   2. Inserts immutable RideEvent
   *   3. Inserts CancellationReason
   *
   * Source: docs/RIDE_STATE_MACHINE.md — REQUESTED → PASSENGER_CANCELLED side effects
   * Source: docs/ENGINEERING_RULES.md — "Every major action must be traceable"
   */
  async cancelByPassenger(
    rideId: string,
    cancellation: CreateCancellationInput,
  ): Promise<Ride> {
    return this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.PASSENGER_CANCELLED },
      });

      await tx.rideEvent.create({
        data: {
          rideId,
          eventType: RideEventType.PASSENGER_CANCELLED,
        },
      });

      await tx.cancellationReason.create({
        data: {
          rideId,
          cancelledBy: CancelledBy.PASSENGER,
          reasonCode: cancellation.reasonCode,
          reasonText: cancellation.reasonText,
        },
      });

      return ride;
    });
  }

  /**
   * Transition an existing ride from REQUESTED → SEARCHING.
   * Atomically updates status and appends the SEARCHING event.
   * Called by RidesService.createRide() immediately after create().
   *
   * Source: docs/RIDE_STATE_MACHINE.md §REQUESTED→SEARCHING
   */
  async transitionToSearching(rideId: string): Promise<Ride> {
    return this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.SEARCHING },
      });
      await tx.rideEvent.create({
        data: { rideId, eventType: RideEventType.SEARCHING },
      });
      return ride;
    });
  }

  /**
   * Insert a standalone RideEvent. Used for future transitions.
   */
  async insertEvent(rideId: string, eventType: RideEventType, payload?: object): Promise<RideEvent> {
    return this.prisma.rideEvent.create({
      data: {
        rideId,
        eventType,
        payload: payload ?? undefined,
      },
    });
  }

  // ─── Phase 3B: Assignment & Driver Lifecycle ──────────────────────────────

  /**
   * Fetch the RideAssignment row for a ride, including the assigned driverId.
   * Returns null if no assignment exists.
   */
  async findAssignmentByRideId(rideId: string): Promise<RideAssignment | null> {
    return this.prisma.rideAssignment.findUnique({ where: { rideId } });
  }

  /**
   * Manually assign a driver to a REQUESTED ride.
   * Atomically:
   *   1. Creates RideAssignment row
   *   2. Updates rides.status = ASSIGNED
   *   3. Inserts RideEvent(ASSIGNED)
   *
   * Source: docs/RIDE_STATE_MACHINE.md — REQUESTED → ASSIGNED
   */
  async assignDriver(
    rideId: string,
    driverId: string,
  ): Promise<{ ride: Ride; assignment: RideAssignment }> {
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.rideAssignment.create({
        data: { rideId, driverId },
      });

      const ride = await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.ASSIGNED },
      });

      await tx.rideEvent.create({
        data: { rideId, eventType: RideEventType.ASSIGNED, payload: { driverId } },
      });

      return { ride, assignment };
    });
  }

  /**
   * Transition ASSIGNED → ACCEPTED.
   * Uses SELECT FOR UPDATE SKIP LOCKED on ride_assignments to safely handle
   * concurrent accept requests from two connections for the same driver.
   *
   * Returns the updated Ride on success.
   * Returns null if the row was already locked (another transaction won the race
   * and accepted first) — caller should treat this as RIDE_ALREADY_ACCEPTED.
   *
   * Source: docs/MATCHING_ENGINE.md §Step 5 — SKIP LOCKED acceptance deduplication
   * Source: docs/RIDE_STATE_MACHINE.md — ASSIGNED → ACCEPTED
   */
  async acceptRide(rideId: string, driverId: string): Promise<Ride | null> {
    return this.prisma.$transaction(async (tx) => {
      // Try to lock the ride_assignments row. SKIP LOCKED means: if another
      // transaction already holds this row, return empty immediately (don't wait).
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM ride_assignments
        WHERE ride_id = ${rideId}::uuid
          AND driver_id = ${driverId}::uuid
          AND accepted_at IS NULL
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return null; // Race lost — already accepted

      await tx.$executeRaw`
        UPDATE ride_assignments
        SET accepted_at = NOW()
        WHERE ride_id = ${rideId}::uuid AND driver_id = ${driverId}::uuid
      `;

      const ride = await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.ACCEPTED },
      });

      await tx.rideEvent.create({
        data: { rideId, eventType: RideEventType.ACCEPTED },
      });

      return ride;
    });
  }

  /**
   * Transition ACCEPTED → ARRIVING.
   * Source: docs/RIDE_STATE_MACHINE.md — ACCEPTED → ARRIVING
   */
  async arriveRide(rideId: string): Promise<Ride> {
    return this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.ARRIVING },
      });

      await tx.rideEvent.create({
        data: { rideId, eventType: RideEventType.ARRIVING },
      });

      return ride;
    });
  }

  /**
   * Transition ARRIVING → IN_PROGRESS.
   * Source: docs/RIDE_STATE_MACHINE.md — ARRIVING → IN_PROGRESS
   */
  async startRide(rideId: string): Promise<Ride> {
    return this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.IN_PROGRESS },
      });

      await tx.rideEvent.create({
        data: { rideId, eventType: RideEventType.STARTED },
      });

      return ride;
    });
  }

  /**
   * Transition IN_PROGRESS → COMPLETED.
   * Atomically:
   *   1. Updates rides.status + completed_at
   *   2. Inserts RideEvent(COMPLETED)
   *   3. Inserts RideFare record (haversine-based flat formula)
   *   4. Inserts DriverEarning ledger entry
   *
   * Fare formula: BASE_FARE + distance_km * PER_KM_RATE
   *
   * Source: docs/RIDE_STATE_MACHINE.md — IN_PROGRESS → COMPLETED side effects
   */
  async completeRide(rideId: string, driverId: string, ride: Ride): Promise<Ride> {
    const distanceKm = haversineKm(
      Number(ride.pickupLat), Number(ride.pickupLng),
      Number(ride.destLat), Number(ride.destLng),
    );
    const fareAmount = parseFloat((BASE_FARE + distanceKm * PER_KM_RATE).toFixed(2));

    return this.prisma.$transaction(async (tx) => {
      const completed = await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.COMPLETED, completedAt: new Date() },
      });

      await tx.rideEvent.create({
        data: { rideId, eventType: RideEventType.COMPLETED },
      });

      await tx.rideFare.create({
        data: { rideId, amount: fareAmount, currency: 'INR' },
      });

      await tx.driverEarning.create({
        data: { driverId, rideId, amount: fareAmount, currency: 'INR' },
      });

      return completed;
    });
  }

  /**
   * Transition ASSIGNED/ACCEPTED/ARRIVING → DRIVER_CANCELLED.
   * Atomically:
   *   1. Updates rides.status
   *   2. Inserts RideEvent(DRIVER_CANCELLED)
   *   3. Inserts CancellationReason
   *
   * Source: docs/RIDE_STATE_MACHINE.md — ACCEPTED/ARRIVING → DRIVER_CANCELLED
   */
  async cancelByDriver(
    rideId: string,
    driverId: string,
    reasonCode: string,
    reasonText?: string,
  ): Promise<Ride> {
    return this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.DRIVER_CANCELLED },
      });

      await tx.rideEvent.create({
        data: { rideId, eventType: RideEventType.DRIVER_CANCELLED },
      });

      await tx.cancellationReason.create({
        data: {
          rideId,
          driverId,
          cancelledBy: CancelledBy.DRIVER,
          reasonCode,
          reasonText,
        },
      });

      return ride;
    });
  }
}

export { ACTIVE_STATUSES };
