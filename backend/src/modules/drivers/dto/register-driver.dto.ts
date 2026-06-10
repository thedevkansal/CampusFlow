/**
 * RegisterDriverDto — validated payload for POST /drivers/register.
 *
 * Source: docs/RBAC.md — POST /drivers/register: DRIVER only
 * Source: schema.prisma — Driver model fields
 */

import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDriverDto {
  @IsString()
  @MinLength(4, { message: 'Vehicle number must be at least 4 characters' })
  @MaxLength(20, { message: 'Vehicle number must not exceed 20 characters' })
  @Matches(/^[A-Z0-9 -]+$/i, { message: 'Vehicle number contains invalid characters' })
  vehicleNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  vehicleModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleColor?: string;
}
