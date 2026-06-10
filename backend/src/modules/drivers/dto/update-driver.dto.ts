/**
 * UpdateDriverDto — validated payload for PATCH /drivers/profile.
 *
 * vehicleNumber is included as optional — no documentation prohibits updating it.
 * vehicleModel and vehicleColor are optional by nature.
 *
 * Source: docs/RBAC.md — PATCH /drivers/profile: DRIVER 🔒 only
 * Source: schema.prisma — Driver model fields
 */

import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateDriverDto {
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  @Matches(/^[A-Z0-9 -]+$/i, { message: 'Vehicle number contains invalid characters' })
  vehicleNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  vehicleModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleColor?: string;
}
