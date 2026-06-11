/**
 * CreateRideDto — validated payload for POST /rides.
 *
 * Source: docs/RBAC.md — POST /rides: PASSENGER only
 * Source: schema.prisma — Ride model (pickupLat/Lng, destLat/Lng, addresses)
 * Source: docs/RIDE_STATE_MACHINE.md — initial state is REQUESTED
 */

import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateRideDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  pickupLat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  pickupLng!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  pickupAddress?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  destLat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  destLng!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  destAddress?: string;
}
