/**
 * MatchingRepository — Prisma writes exclusive to the matching engine.
 *
 * All writes use explicit transactions. The assignment write uses
 * SELECT FOR UPDATE to prevent two concurrent workers from assigning
 * different drivers to the same ride.
 *
 * Source: docs/MATCHING_ENGINE.md §Step 5 — Race Condition Prevention
 * Source: docs/RIDE_STATE_MACHINE.md — SEARCHING→ASSIGNED, →NO_DRIVER_FOUND, ASSIGNED→TIMED_OUT
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { RideStatus, RideEventType } from '@prisma/client';

@Injectable()
export class MatchingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read current ride status from PostgreSQL.
   * Used by the worker to verify ride is still SEARCHING before committing.
   */
  async getRideStatus(rideId: string): Promise<RideStatus | null> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { status: true },
    });
    return ride?.status ?? null;
  }

  /**
   * Read the assignment row for a ride (driverId lookup).
   */
  async getAssignment(rideId: string): Promise<{ driverId: string } | null> {
    return this.prisma.rideAssignment.findUnique({
      where: { rideId },
      select: { driverId: true },
    });
  }

  /**
   * Atomically assign a driver to a ride at SEARCHING status.
   *
   * Uses SELECT FOR UPDATE on the rides row so that if two workers race,
   * only one can commit the ASSIGNED write — the other sees a non-SEARCHING
   * status and aborts.
   *
   * Returns true on success, false if ride was no longer SEARCHING
   * (cancelled by passenger mid-flight, or another worker beat us).
   *
   * Source: docs/MATCHING_ENGINE.md §Step 5 Layer 2 — SELECT FOR UPDATE
   */
  async assignRideToDriver(rideId: string, driverId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM rides WHERE id = ${rideId}::uuid FOR UPDATE
      `;

      if (!rows[0] || rows[0].status !== 'SEARCHING') return false;

      await tx.rideAssignment.create({ data: { rideId, driverId } });

      await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.ASSIGNED },
      });

      await tx.rideEvent.create({
        data: { rideId, eventType: RideEventType.ASSIGNED, payload: { driverId } },
      });

      return true;
    });
  }

  /**
   * Transition ride to NO_DRIVER_FOUND (terminal state).
   * Source: docs/RIDE_STATE_MACHINE.md §SEARCHING→NO_DRIVER_FOUND
   */
  async transitionToNoDriverFound(rideId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.NO_DRIVER_FOUND },
      });
      await tx.rideEvent.create({
        data: { rideId, eventType: RideEventType.NO_DRIVER_FOUND },
      });
    });
  }

  /**
   * Transition ride to TIMED_OUT (terminal state).
   * Called by the acceptance-timeout BullMQ job.
   * Source: docs/RIDE_STATE_MACHINE.md §ASSIGNED→TIMED_OUT
   */
  async transitionToTimedOut(rideId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.TIMED_OUT },
      });
      await tx.rideEvent.create({
        data: { rideId, eventType: RideEventType.TIMED_OUT },
      });
    });
  }
}
