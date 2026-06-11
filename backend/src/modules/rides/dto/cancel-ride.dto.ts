/**
 * CancelRideDto — validated payload for POST /rides/:id/cancel.
 *
 * reasonCode is required by the CancellationReason schema — it must always
 * be provided so the event log is complete and traceable.
 *
 * Source: docs/RIDE_STATE_MACHINE.md — REQUESTED → PASSENGER_CANCELLED side effects
 * Source: schema.prisma — CancellationReason model (reasonCode VARCHAR(50), reasonText?)
 * Source: docs/ENGINEERING_RULES.md — "Every major action must be traceable"
 */

import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CancelRideDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reasonText?: string;
}
