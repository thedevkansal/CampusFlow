/**
 * DriversRepository — data access layer for Driver and DriverLocation records.
 *
 * All Driver-related database queries are isolated here.
 * Service layer calls this repository; controllers never touch Prisma directly.
 *
 * Source: docs/ENGINEERING_RULES.md — "Repository pattern. Service layer abstraction."
 * Source: schema.prisma — Driver, DriverLocation models
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { Driver, DriverLocation, DriverStatus } from '@prisma/client';

export interface CreateDriverInput {
  userId: string;
  vehicleNumber: string;
  vehicleModel?: string;
  vehicleColor?: string;
}

export interface UpdateDriverInput {
  vehicleNumber?: string;
  vehicleModel?: string;
  vehicleColor?: string;
}

export interface UpsertLocationInput {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
}

export type DriverWithLocation = Driver & { location: DriverLocation | null };

@Injectable()
export class DriversRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find a Driver record by the owning user's ID.
   * Includes the current location record.
   * Used for ownership validation and profile reads.
   */
  async findByUserId(userId: string): Promise<DriverWithLocation | null> {
    return this.prisma.driver.findUnique({
      where: { userId },
      include: { location: true },
    });
  }

  /**
   * Find a Driver record by its own primary key.
   * Includes the current location record.
   */
  async findByDriverId(driverId: string): Promise<DriverWithLocation | null> {
    return this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { location: true },
    });
  }

  /**
   * Check whether a Driver record already exists for this user.
   * Prevents duplicate registrations.
   */
  async existsByUserId(userId: string): Promise<boolean> {
    const count = await this.prisma.driver.count({ where: { userId } });
    return count > 0;
  }

  /**
   * Create a new Driver record linked to an existing User.
   * Status defaults to OFFLINE; isVerified defaults to false per schema.
   */
  async create(data: CreateDriverInput): Promise<Driver> {
    return this.prisma.driver.create({
      data: {
        userId: data.userId,
        vehicleNumber: data.vehicleNumber,
        vehicleModel: data.vehicleModel,
        vehicleColor: data.vehicleColor,
      },
    });
  }

  /**
   * Update mutable vehicle fields on an existing Driver record.
   */
  async updateProfile(driverId: string, data: UpdateDriverInput): Promise<Driver> {
    return this.prisma.driver.update({
      where: { id: driverId },
      data: {
        ...(data.vehicleNumber !== undefined && { vehicleNumber: data.vehicleNumber }),
        ...(data.vehicleModel !== undefined && { vehicleModel: data.vehicleModel }),
        ...(data.vehicleColor !== undefined && { vehicleColor: data.vehicleColor }),
      },
    });
  }

  /**
   * Batch-fetch driver records by a list of driverIds.
   * Used by MatchingService to retrieve rating data for candidate ranking.
   * Returns only fields needed for scoring — no location included.
   *
   * Source: docs/MATCHING_ENGINE.md §Step 4 — ranking uses driver.rating
   */
  async findByDriverIds(driverIds: string[]): Promise<Driver[]> {
    if (driverIds.length === 0) return [];
    return this.prisma.driver.findMany({
      where: { id: { in: driverIds } },
    });
  }

  /**
   * Update driver availability status (ONLINE / OFFLINE).
   * Called by goOnline() and goOffline() in service.
   */
  async updateStatus(driverId: string, status: DriverStatus): Promise<Driver> {
    return this.prisma.driver.update({
      where: { id: driverId },
      data: { status },
    });
  }

  /**
   * Upsert the driver's current location.
   * Uses Prisma upsert — creates row on first call, updates on subsequent calls.
   * DriverLocation has a unique constraint on driverId (1:1 with Driver).
   *
   * Source: schema.prisma — DriverLocation model (@@unique via @unique on driverId)
   */
  async upsertLocation(
    driverId: string,
    data: UpsertLocationInput,
  ): Promise<DriverLocation> {
    return this.prisma.driverLocation.upsert({
      where: { driverId },
      update: {
        latitude: data.latitude,
        longitude: data.longitude,
        ...(data.heading !== undefined && { heading: data.heading }),
        ...(data.speed !== undefined && { speed: data.speed }),
      },
      create: {
        driverId,
        latitude: data.latitude,
        longitude: data.longitude,
        heading: data.heading,
        speed: data.speed,
      },
    });
  }
}
