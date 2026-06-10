/**
 * AuthModule — authentication and authorisation foundation.
 *
 * Module registration follows the pattern established by other modules:
 * - Infrastructure modules (PrismaModule, RedisModule) are @Global() and
 *   do not need to be imported here — they are already available globally.
 * - AppConfigModule provides AppConfigService (also @Global via ConfigModule.forRoot).
 *
 * Exports:
 * - JwtAuthGuard   — for use by all future feature modules (Drivers, Rides, etc.)
 * - RolesGuard     — for use by all future feature modules
 * - UsersRepository — for future UsersModule (Phase 2B) to avoid duplication
 *
 * JwtModule is configured asynchronously to read secrets from AppConfigService,
 * which enforces the "No secrets in source code" rule from ENGINEERING_RULES.md.
 *
 * Source: docs/ARCHITECTURE.md — "Auth" module listed first in feature modules
 * Source: docs/ENGINEERING_RULES.md — "Environment variables only. No secrets in source code."
 * Source: docs/RBAC.md — "JWT Guard → RolesGuard → OwnershipGuard → Controller → Service"
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigModule } from '@common/config/config.module';
import { AppConfigService } from '@common/config/app-config.service';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersRepository } from './users.repository';
import { TokenService } from './token.service';
import { RateLimitService } from './rate-limit.service';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    AppConfigModule,

    // Passport — default strategy is 'jwt' (access token)
    PassportModule.register({ defaultStrategy: 'jwt' }),

    /**
     * JwtModule is configured with the ACCESS token secret.
     * Refresh token signing uses a different secret — handled directly
     * in TokenService.generateRefreshToken() via jwtService.sign() overrides.
     *
     * Source: docs/ENGINEERING_RULES.md — "Environment variables only"
     */
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        ({
          secret: config.jwtSecret,
          signOptions: {
            // Cast needed: @nestjs/jwt v10+ uses branded StringValue for expiresIn
            expiresIn: config.jwtAccessExpiresIn as unknown,
          },
        }) as Parameters<typeof JwtModule.register>[0],
    }),
  ],

  controllers: [AuthController],

  providers: [
    AuthService,
    UsersRepository,
    TokenService,
    RateLimitService,
    JwtAccessStrategy,
    JwtRefreshStrategy,
    JwtAuthGuard,
    RolesGuard,
  ],

  exports: [
    /**
     * Exported so all future feature modules can use these without re-importing AuthModule.
     * Usage in other modules:
     *   @UseGuards(JwtAuthGuard, RolesGuard)
     *   @Roles(Role.PASSENGER)
     */
    JwtAuthGuard,
    RolesGuard,
    /**
     * Exported for future UsersModule (Phase 2B) to avoid duplicating
     * the user query logic.
     */
    UsersRepository,
    JwtModule,
    /**
     * Exported for DriversModule (Phase 2C) and any future module requiring
     * rate limiting — reuses the same NX+INCR Redis pattern via check().
     */
    RateLimitService,
  ],
})
export class AuthModule {}
