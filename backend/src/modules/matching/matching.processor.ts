/**
 * MatchingProcessor — BullMQ worker for the ride-matching queue.
 *
 * Handles two job types:
 *   match-ride          — candidate discovery, locking, assignment
 *   acceptance-timeout  — transitions ASSIGNED → TIMED_OUT if driver did not accept
 *
 * Locking strategy (two layers):
 *   Layer 1: Redis driver:lock:{driverId} NX EX 20   — fast path, prevents contention
 *   Layer 2: PostgreSQL SELECT FOR UPDATE             — commit-path safety net
 *
 * Source: docs/MATCHING_ENGINE.md §Step 5
 * Source: docs/RIDE_STATE_MACHINE.md §SEARCHING→ASSIGNED, §ASSIGNED→TIMED_OUT
 * Source: docs/REDIS_SCHEMA.md §6, §7, §8
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { RideStatus } from '@prisma/client';
import { MatchingService } from './matching.service';
import { MatchingRepository } from './matching.repository';
import { RedisService } from '@modules/redis/redis.service';
import { AppConfigService } from '@common/config/app-config.service';
import { RideEventsService } from '@modules/gateway/ride-events.service';
import { QUEUE_NAMES, JOB_NAMES } from '@modules/queue/queue.constants';

// ── Job payload interfaces ────────────────────────────────────────────────────

export interface MatchRideJobPayload {
  rideId: string;
  passengerId: string;
  pickupLat: number;
  pickupLng: number;
  requestedAt: string;
  attemptNumber: number;
  excludeDriverIds: string[];
}

export interface AcceptanceTimeoutPayload {
  rideId: string;
  assignedDriverId: string;
}

// ── Processor ────────────────────────────────────────────────────────────────

@Processor(QUEUE_NAMES.RIDE_MATCHING, { concurrency: 5 })
export class MatchingProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchingProcessor.name);

  constructor(
    private readonly matchingService: MatchingService,
    private readonly matchingRepository: MatchingRepository,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    private readonly rideEventsService: RideEventsService,
    @InjectQueue(QUEUE_NAMES.RIDE_MATCHING) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_NAMES.MATCH_RIDE) {
      await this.handleMatchRide(job as Job<MatchRideJobPayload>);
    } else if (job.name === JOB_NAMES.ACCEPTANCE_TIMEOUT) {
      await this.handleAcceptanceTimeout(job as Job<AcceptanceTimeoutPayload>);
    }
  }

  // ── match-ride ─────────────────────────────────────────────────────────────

  private async handleMatchRide(job: Job<MatchRideJobPayload>): Promise<void> {
    const { rideId, pickupLat, pickupLng, excludeDriverIds } = job.data;

    // Verify ride is still SEARCHING (may have been cancelled while job was queued)
    const currentStatus = await this.matchingRepository.getRideStatus(rideId);
    if (currentStatus !== RideStatus.SEARCHING) {
      this.logger.warn(`Skipping match-ride: rideId=${rideId} status=${currentStatus}`);
      return;
    }

    // Discover and rank candidates
    const candidates = await this.matchingService.findAndRankCandidates(
      pickupLat,
      pickupLng,
      excludeDriverIds,
    );

    if (candidates.length === 0) {
      await this.matchingRepository.transitionToNoDriverFound(rideId);
      await this.redis.del(this.redis.keys.rideActive(rideId));
      await this.redis.del(this.redis.keys.rideLock(rideId));
      this.logger.log(`No driver found: rideId=${rideId}`);
      return;
    }

    // Try each ranked candidate until one is successfully assigned
    let assigned = false;

    for (const candidate of candidates) {
      // Layer 1: Redis distributed lock — fast path
      const driverLockAcquired = await this.redis.setNx(
        this.redis.keys.driverLock(candidate.driverId),
        rideId,
        20,
      );
      if (!driverLockAcquired) continue;

      // Layer 2: PostgreSQL SELECT FOR UPDATE — commit-path safety net
      const success = await this.matchingRepository.assignRideToDriver(rideId, candidate.driverId);

      if (!success) {
        // Ride changed state between our status check and the transaction —
        // release the driver lock so the driver remains eligible for other rides.
        await this.redis.del(this.redis.keys.driverLock(candidate.driverId));
        break; // Ride is no longer SEARCHING; stop trying
      }

      // ── Assignment committed ─────────────────────────────────────────────

      const windowMs = this.config.matchingAcceptanceWindowMs;
      const deadlineIso = new Date(Date.now() + windowMs).toISOString();

      // Update driver and ride caches
      await this.redis.set(this.redis.keys.driverStatus(candidate.driverId), 'BUSY', 60);
      await this.redis.hset(this.redis.keys.rideActive(rideId), {
        status: 'ASSIGNED',
        driver_id: candidate.driverId,
        updated_at: new Date().toISOString(),
      });
      await this.redis.expire(this.redis.keys.rideActive(rideId), 86400);

      // Set acceptance deadline reference (used by timeout job to detect early accept).
      // TTL must exceed the job delay by a buffer — if TTL === delay the key can expire
      // before the delayed job is dequeued, causing a false "driver accepted" no-op.
      await this.redis.set(
        this.redis.keys.rideAcceptanceDeadline(rideId),
        deadlineIso,
        Math.ceil(windowMs / 1000) + 30,
      );


      // Enqueue delayed acceptance-timeout job
      await this.queue.add(
        JOB_NAMES.ACCEPTANCE_TIMEOUT,
        { rideId, assignedDriverId: candidate.driverId } satisfies AcceptanceTimeoutPayload,
        {
          delay: windowMs,
          jobId: `acceptance-timeout:${rideId}`,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      // Release ride lock — matching is complete
      await this.redis.del(this.redis.keys.rideLock(rideId));

      await this.rideEventsService.emitRideAssigned(rideId, job.data.passengerId, candidate.driverId);
      this.logger.log(
        `Ride assigned: rideId=${rideId} driverId=${candidate.driverId} ` +
          `score=${candidate.score.toFixed(3)} distKm=${candidate.distanceKm.toFixed(2)}`,
      );
      assigned = true;
      break;
    }

    if (!assigned) {
      // All candidates tried; none succeeded
      await this.matchingRepository.transitionToNoDriverFound(rideId);
      await this.redis.del(this.redis.keys.rideActive(rideId));
      await this.redis.del(this.redis.keys.rideLock(rideId));
      this.logger.log(`No driver available after filtering all candidates: rideId=${rideId}`);
    }
  }

  // ── acceptance-timeout ────────────────────────────────────────────────────

  private async handleAcceptanceTimeout(job: Job<AcceptanceTimeoutPayload>): Promise<void> {
    const { rideId, assignedDriverId } = job.data;

    // If acceptance_deadline key no longer exists, driver already accepted — no-op.
    // Source: MATCHING_ENGINE.md §Step 7 "If no response (timeout fires)"
    const deadlineExists = await this.redis.exists(this.redis.keys.rideAcceptanceDeadline(rideId));
    if (!deadlineExists) return;

    await this.matchingRepository.transitionToTimedOut(rideId);

    // Redis cleanup + driver reset
    await this.redis.del(this.redis.keys.rideActive(rideId));
    await this.redis.del(this.redis.keys.driverLock(assignedDriverId));
    await this.redis.set(this.redis.keys.driverStatus(assignedDriverId), 'ONLINE', 60);

    // Increment rolling 24h timeout counter (REDIS_SCHEMA §15)
    const newCount = await this.redis.incr(this.redis.keys.driverTimeoutCount(assignedDriverId));
    if (newCount === 1) {
      await this.redis.expire(this.redis.keys.driverTimeoutCount(assignedDriverId), 86400);
    }

    this.logger.log(`Ride timed out: rideId=${rideId} driverId=${assignedDriverId}`);
  }
}
