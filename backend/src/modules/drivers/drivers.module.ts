/**
 * DriversModule — driver registration, profile, availability, and location management.
 *
 * Imports AuthModule to consume its exports without re-declaring them:
 *   - JwtAuthGuard    → used in DriversController
 *   - RolesGuard      → used in DriversController
 *   - RateLimitService → reused for PATCH /drivers/location (120/min)
 *   - JwtModule       → required by guards for JwtService resolution
 *
 * PrismaModule is @Global() — no explicit import needed.
 *
 * Source: docs/RBAC.md — Driver Endpoints
 * Source: docs/API_CONTRACTS.md — Drivers section
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { GatewayModule } from '@modules/gateway/gateway.module';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { DriversRepository } from './drivers.repository';

@Module({
  imports: [AuthModule, GatewayModule],
  controllers: [DriversController],
  providers: [DriversService, DriversRepository],
  exports: [DriversRepository, DriversService],
})
export class DriversModule {}

