/**
 * LocationModule — driver location persistence and stale cleanup.
 *
 * Provides:
 *   - LocationPersistenceProcessor: BullMQ worker for async DB writes and stale cleanup
 *   - StaleDriverCleanupService: schedules repeatable cleanup job on startup
 *
 * Source: docs/ARCHITECTURE.md — "Location Persistence Pipeline"
 * Source: docs/REDIS_SCHEMA.md §3 — Driver Geospatial Index (stale cleanup)
 */

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@modules/queue/queue.constants';
import { LocationPersistenceProcessor } from './location-persistence.processor';
import { StaleDriverCleanupService } from './stale-driver-cleanup.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.LOCATION_PERSISTENCE }),
  ],
  providers: [LocationPersistenceProcessor, StaleDriverCleanupService],
})
export class LocationModule {}
