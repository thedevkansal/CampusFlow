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

/** Active ride states — ride is not yet in a terminal state */
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
}

export { ACTIVE_STATUSES };
