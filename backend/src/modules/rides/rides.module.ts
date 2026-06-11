/**
 * RidesModule — ride creation, retrieval, and passenger cancellation (Phase 3A).
 *
 * Imports AuthModule to consume:
 *   - JwtAuthGuard    (controller class-level guard)
 *   - RolesGuard      (per-route role enforcement)
 *   - JwtModule       (required by guard for JwtService resolution)
 *
 * PrismaModule is @Global() — PrismaService is available without explicit import.
 *
 * Phase 4 will add MatchingModule dependency for ride assignment lifecycle.
 *
 * Source: docs/RBAC.md — Ride Endpoints
 * Source: docs/API_CONTRACTS.md — Rides section
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { DriversModule } from '@modules/drivers/drivers.module';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { RidesRepository } from './rides.repository';

@Module({
  imports: [AuthModule, DriversModule],
  controllers: [RidesController],
  providers: [RidesService, RidesRepository],
  exports: [RidesRepository],
})
export class RidesModule {}
