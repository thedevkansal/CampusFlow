/**
 * StaleDriverCleanupService — registers the repeatable cleanup BullMQ job on startup.
 *
 * Schedules a cleanup-stale-drivers job to run every 60 seconds via BullMQ repeatable jobs.
 * The actual cleanup logic lives in LocationPersistenceProcessor.cleanupStaleDrivers().
 *
 * Source: docs/REDIS_SCHEMA.md §3 — "Background job runs every 60s to remove members
 *         whose driver:location:{driverId} key has expired (stale drivers)"
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '@modules/queue/queue.constants';

const CLEANUP_INTERVAL_MS = 60_000; // 60s

@Injectable()
export class StaleDriverCleanupService implements OnModuleInit {
  private readonly logger = new Logger(StaleDriverCleanupService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.LOCATION_PERSISTENCE)
    private readonly locationQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Remove any existing repeatable job to avoid duplicates on restart
    const repeatableJobs = await this.locationQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name === JOB_NAMES.CLEANUP_STALE_DRIVERS) {
        await this.locationQueue.removeRepeatableByKey(job.key);
      }
    }

    // Schedule repeatable cleanup job every 60s
    await this.locationQueue.add(
      JOB_NAMES.CLEANUP_STALE_DRIVERS,
      {},
      { repeat: { every: CLEANUP_INTERVAL_MS } },
    );

    this.logger.log(`Stale driver cleanup job scheduled every ${CLEANUP_INTERVAL_MS / 1000}s`);
  }
}
