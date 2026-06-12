/**
 * LocationPersistenceProcessor — BullMQ worker for the location-persistence queue.
 *
 * Handles two job types:
 *   flush-driver-location   — async batch write of driver GPS coordinates to PostgreSQL
 *   cleanup-stale-drivers   — removes drivers from drivers:geo whose location TTL has expired
 *
 * Source: docs/ARCHITECTURE.md — "Location Persistence Pipeline"
 * Source: docs/REDIS_SCHEMA.md §3 — Driver Geospatial Index (stale member cleanup)
 */

import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '@prisma/prisma.service';
import { RedisService } from '@modules/redis/redis.service';
import { JOB_NAMES, QUEUE_NAMES } from '@modules/queue/queue.constants';

export interface FlushDriverLocationJobData {
  driverId: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  timestamp: string;
}

@Processor(QUEUE_NAMES.LOCATION_PERSISTENCE)
export class LocationPersistenceProcessor extends WorkerHost {
  private readonly logger = new Logger(LocationPersistenceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.FLUSH_DRIVER_LOCATION:
        await this.flushDriverLocation(job.data as FlushDriverLocationJobData);
        break;
      case JOB_NAMES.CLEANUP_STALE_DRIVERS:
        await this.cleanupStaleDrivers();
        break;
      default:
        this.logger.warn(`Unknown job: ${job.name}`);
    }
  }

  /**
   * Write a single driver location update to PostgreSQL.
   * The socket path enqueues these instead of writing directly to avoid DB pressure.
   */
  private async flushDriverLocation(data: FlushDriverLocationJobData): Promise<void> {
    await this.prisma.driverLocation.upsert({
      where: { driverId: data.driverId },
      update: {
        latitude: data.latitude,
        longitude: data.longitude,
        ...(data.heading !== undefined && { heading: data.heading }),
        ...(data.speed !== undefined && { speed: data.speed }),
      },
      create: {
        driverId: data.driverId,
        latitude: data.latitude,
        longitude: data.longitude,
        heading: data.heading,
        speed: data.speed,
      },
    });
  }

  /**
   * Cleanup stale driver entries from the drivers:geo GEO sorted set.
   * A driver is stale if driver:location:{driverId} (30s TTL) has expired.
   * Also removes from drivers:online set if they have no active status key.
   *
   * Source: docs/REDIS_SCHEMA.md §3 — "Background job runs every 60s to remove members
   *         whose driver:location:{driverId} key has expired (stale drivers)"
   */
  private async cleanupStaleDrivers(): Promise<void> {
    const client = this.redis.getClient();

    // Get all current members of the GEO set
    const members = await client.zrange(this.redis.keys.driversGeo(), 0, -1);
    if (members.length === 0) return;

    let removedCount = 0;
    for (const driverId of members) {
      const locationExists = await this.redis.exists(this.redis.keys.driverLocation(driverId));
      if (!locationExists) {
        await this.redis.geoRemove(this.redis.keys.driversGeo(), driverId);
        await this.redis.srem(this.redis.keys.driversOnline(), driverId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.log(`Stale driver cleanup: removed ${removedCount} of ${members.length} members from drivers:geo`);
    }
  }
}
