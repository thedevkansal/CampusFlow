/**
 * AppModule — root module of the CampusFlow backend.
 *
 * Module registration order:
 * 1. Infrastructure modules (Config, Logger, Prisma, Redis, Queue, Gateway)
 * 2. Health module
 * 3. Feature modules (added as development progresses per ROADMAP.md)
 *
 * Source: docs/ARCHITECTURE.md — Module list
 * Source: docs/ROADMAP.md — Phase 2+ feature modules
 */

import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

// Infrastructure modules
import { AppConfigModule } from '@common/config/config.module';
import { LoggerModule } from '@modules/logger/logger.module';
import { PrismaModule } from '@prisma/prisma.module';
import { RedisModule } from '@modules/redis/redis.module';
import { QueueModule } from '@modules/queue/queue.module';
import { GatewayModule } from '@modules/gateway/gateway.module';
import { PricingModule } from '@modules/pricing/pricing.module';
import { HealthModule } from '@modules/health/health.module';

// Global providers
import { GlobalExceptionFilter } from '@common/filters/global-exception.filter';

// Feature modules
import { AuthModule } from '@modules/auth/auth.module';
import { UsersModule } from '@modules/users/users.module';
import { DriversModule } from '@modules/drivers/drivers.module';
import { RidesModule } from '@modules/rides/rides.module';
import { MatchingModule } from '@modules/matching/matching.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';

@Module({
  imports: [
    // ── Infrastructure (must load first) ──────────────────────────────────────
    AppConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    GatewayModule,
    PricingModule,

    // ── Observability ─────────────────────────────────────────────────────────
    HealthModule,

    // ── Feature Modules (added per ROADMAP.md phases) ─────────────────────────
    // Phase 2A: Authentication Foundation
    AuthModule,
    // Phase 2B: Users
    UsersModule,
    // Phase 2C: Drivers
    DriversModule,
    // Phase 3A: Rides (foundation — create, list, detail, cancel)
    RidesModule,
    // Phase 3C: Matching Engine (BullMQ worker — driver candidate selection + assignment)
    MatchingModule,
    // Phase 4B: In-App Notifications
    NotificationsModule,
    // Phase 5: (realtime — already wired via GatewayModule)
    // Phase 7: AnalyticsModule
    // Phase 8: DemandForecastingModule
    // Phase 2+: AdminModule
  ],
  providers: [
    // Global exception filter — catches all unhandled exceptions
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },

    // Global validation pipe — validates all DTOs
    // Source: docs/ENGINEERING_RULES.md — "DTO validation mandatory"
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,          // Strip properties not in DTO
        forbidNonWhitelisted: true, // Throw on extra properties
        transform: true,          // Auto-transform payloads to DTO instances
        transformOptions: {
          enableImplicitConversion: true,
        },
        stopAtFirstError: false,  // Return all validation errors at once
      }),
    },
  ],
})
export class AppModule {}
