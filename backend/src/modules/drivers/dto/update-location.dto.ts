/**
 * UpdateLocationDto — validated payload for PATCH /drivers/location.
 *
 * Source: docs/RBAC.md — PATCH /drivers/location: DRIVER 🔒, rate limited 120/min
 * Source: schema.prisma — DriverLocation model
 */

import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  /** Heading in degrees (0–360). Optional. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  /** Speed in km/h. Optional. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;
}
