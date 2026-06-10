/**
 * UsersModule — user profile read and update operations.
 *
 * Imports AuthModule to consume its exports:
 *   - JwtAuthGuard    (used in UsersController)
 *   - RolesGuard      (used in UsersController)
 *   - UsersRepository (used in UsersService — no duplication)
 *   - JwtModule       (needed for guard to resolve JwtService)
 *
 * PrismaModule and RedisModule are @Global() — no explicit import needed.
 *
 * Source: docs/RBAC.md — User Endpoints (GET/PATCH /users/profile)
 * Source: docs/ARCHITECTURE.md — "Users" module
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
