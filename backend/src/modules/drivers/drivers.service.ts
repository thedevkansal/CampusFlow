/**
 * DriversService — all driver business logic.
 *
 * Ownership enforcement: every method that is driver-scoped receives `userId`
 * from `req.user.id` (never from a client-supplied param). The service fetches
 * the Driver record by userId and uses its `id` for subsequent operations.
 *
 * Source: docs/RBAC.md — Driver Endpoints matrix
 * Source: docs/ENGINEERING_RULES.md — "No business logic in controllers"
 * Source: docs/ENGINEERING_RULES.md — "Every major action must be traceable"
 */

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DriverStatus } from '@prisma/client';
import { DriversRepository, DriverWithLocation } from './drivers.repository';
import { RateLimitService } from '@modules/auth/rate-limit.service';
import { RegisterDriverDto } from './dto/register-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { UpdateLocationDto } from './dto/update-location.dto';


/** Rate limit: 120 location updates / 60s per driver (RBAC.md §Driver Endpoints) */
const LOCATION_RATE_LIMIT = { slug: 'drivers_location', limit: 120, windowSeconds: 60 };

export interface DriverProfileData {
  id: string;
  userId: string;
  vehicleNumber: string;
  vehicleModel: string | null;
  vehicleColor: string | null;
  rating: string;
  totalRatings: number;
  status: DriverStatus;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  location: {
    latitude: string;
    longitude: string;
    heading: string | null;
    speed: string | null;
    updatedAt: Date;
  } | null;
}

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private readonly driversRepository: DriversRepository,
    private readonly rateLimitService: RateLimitService,
  ) {}

  /**
   * Register a new Driver profile for an authenticated DRIVER-role user.
   *
   * Guards at controller level ensure only DRIVER-role users reach this method.
   * Service-level check prevents duplicate registrations.
   *
   * Source: docs/RBAC.md — POST /drivers/register: DRIVER only, userId = req.user.id
   */
  async register(userId: string, dto: RegisterDriverDto): Promise<DriverProfileData> {
    const alreadyExists = await this.driversRepository.existsByUserId(userId);
    if (alreadyExists) {
      throw new ConflictException({
        message: 'A driver profile already exists for this account',
        code: 'DRIVER_ALREADY_REGISTERED',
      });
    }

    const driver = await this.driversRepository.create({
      userId,
      vehicleNumber: dto.vehicleNumber,
      vehicleModel: dto.vehicleModel,
      vehicleColor: dto.vehicleColor,
    });

    this.logger.log(`Driver registered: driverId=${driver.id} userId=${userId}`);

    return this.toProfileData({ ...driver, location: null });
  }

  /**
   * Return a driver's profile.
   *
   * - DRIVER role: fetch by userId — only own record is accessible.
   * - ADMIN role: also fetch by userId (self-referential on this route).
   *   An admin with no driver record receives 404 — expected and correct.
   *
   * Source: docs/RBAC.md — GET /drivers/profile: DRIVER 🔒 ADMIN 👑
   */
  async getProfile(userId: string): Promise<DriverProfileData> {
    const driver = await this.driversRepository.findByUserId(userId);
    if (!driver) {
      throw new NotFoundException({
        message: 'Driver profile not found',
        code: 'RESOURCE_NOT_FOUND',
      });
    }
    return this.toProfileData(driver);
  }

  /**
   * Update mutable vehicle fields on a driver's profile.
   * Ownership is implicit — operates on the record matching the caller's userId.
   *
   * Source: docs/RBAC.md — PATCH /drivers/profile: DRIVER 🔒 only (ADMIN ❌)
   */
  async updateProfile(userId: string, dto: UpdateDriverDto): Promise<DriverProfileData> {
    const driver = await this.driversRepository.findByUserId(userId);
    if (!driver) {
      throw new NotFoundException({
        message: 'Driver profile not found',
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    // No-op if nothing to update
    if (
      dto.vehicleNumber === undefined &&
      dto.vehicleModel === undefined &&
      dto.vehicleColor === undefined
    ) {
      return this.toProfileData(driver);
    }

    const updated = await this.driversRepository.updateProfile(driver.id, {
      vehicleNumber: dto.vehicleNumber,
      vehicleModel: dto.vehicleModel,
      vehicleColor: dto.vehicleColor,
    });

    this.logger.log(`Driver profile updated: driverId=${driver.id}`);

    return this.toProfileData({ ...updated, location: driver.location });
  }

  /**
   * Set the driver's status to ONLINE.
   *
   * Source: docs/RBAC.md — POST /drivers/online: DRIVER 🔒
   */
  async goOnline(userId: string): Promise<{ status: DriverStatus }> {
    const driver = await this.requireDriverRecord(userId);
    await this.driversRepository.updateStatus(driver.id, DriverStatus.ONLINE);
    this.logger.log(`Driver online: driverId=${driver.id}`);
    return { status: DriverStatus.ONLINE };
  }

  /**
   * Set the driver's status to OFFLINE.
   *
   * Source: docs/RBAC.md — POST /drivers/offline: DRIVER 🔒
   */
  async goOffline(userId: string): Promise<{ status: DriverStatus }> {
    const driver = await this.requireDriverRecord(userId);
    await this.driversRepository.updateStatus(driver.id, DriverStatus.OFFLINE);
    this.logger.log(`Driver offline: driverId=${driver.id}`);
    return { status: DriverStatus.OFFLINE };
  }

  /**
   * Upsert the driver's current GPS coordinates.
   * Rate limited: 120 requests / 60s per userId.
   *
   * Source: docs/RBAC.md — PATCH /drivers/location: DRIVER 🔒, rate limited 120/min
   */
  async updateLocation(
    userId: string,
    dto: UpdateLocationDto,
  ): Promise<{ latitude: string; longitude: string; updatedAt: Date }> {
    // Rate limit check — keyed by userId for per-driver limiting
    await this.rateLimitService.check(
      LOCATION_RATE_LIMIT.slug,
      userId,
      LOCATION_RATE_LIMIT.limit,
      LOCATION_RATE_LIMIT.windowSeconds,
    );

    const driver = await this.requireDriverRecord(userId);

    if (driver.status !== DriverStatus.ONLINE) {
      throw new ForbiddenException({
        message: 'Driver must be ONLINE to update location',
        code: 'DRIVER_NOT_ONLINE',
      });
    }

    const location = await this.driversRepository.upsertLocation(driver.id, {
      latitude: dto.latitude,
      longitude: dto.longitude,
      heading: dto.heading,
      speed: dto.speed,
    });

    return {
      latitude: location.latitude.toString(),
      longitude: location.longitude.toString(),
      updatedAt: location.updatedAt,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Fetch the driver record for a given userId or throw 404.
   * Used internally to obtain the driverId before status/location writes.
   */
  private async requireDriverRecord(userId: string): Promise<DriverWithLocation> {
    const driver = await this.driversRepository.findByUserId(userId);
    if (!driver) {
      throw new NotFoundException({
        message: 'Driver profile not found. Please register as a driver first.',
        code: 'RESOURCE_NOT_FOUND',
      });
    }
    return driver;
  }

  /**
   * Map a Prisma Driver+Location record to the typed API response shape.
   * Prisma Decimal fields are serialised to strings for JSON safety.
   */
  private toProfileData(driver: DriverWithLocation): DriverProfileData {
    return {
      id: driver.id,
      userId: driver.userId,
      vehicleNumber: driver.vehicleNumber,
      vehicleModel: driver.vehicleModel,
      vehicleColor: driver.vehicleColor,
      rating: driver.rating.toString(),
      totalRatings: driver.totalRatings,
      status: driver.status,
      isVerified: driver.isVerified,
      createdAt: driver.createdAt,
      updatedAt: driver.updatedAt,
      location: driver.location
        ? {
            latitude: driver.location.latitude.toString(),
            longitude: driver.location.longitude.toString(),
            heading: driver.location.heading?.toString() ?? null,
            speed: driver.location.speed?.toString() ?? null,
            updatedAt: driver.location.updatedAt,
          }
        : null,
    };
  }
}
