/**
 * CancelDriverDto — payload for POST /rides/:id/cancel-driver.
 *
 * Driver cancellation requires a reasonCode for the cancellation_reasons audit log.
 *
 * Source: docs/RIDE_STATE_MACHINE.md — ACCEPTED/ARRIVING → DRIVER_CANCELLED side effects
 * Source: schema.prisma — CancellationReason model
 */

import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CancelDriverDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reasonText?: string;
}
