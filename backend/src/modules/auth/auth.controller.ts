/**
 * AuthController — thin HTTP layer for auth endpoints.
 *
 * Route handlers do exactly three things:
 *   1. Accept the validated DTO (validation handled by global ValidationPipe)
 *   2. Call the service
 *   3. Wrap the result in the standard API envelope
 *
 * Rate limiting is enforced here using RedisService (existing application Redis pool)
 * matching the limits defined in docs/REDIS_SCHEMA.md §11 Rate Limiting Counters:
 *   - POST /auth/login:    5 requests / 60s  per IP  (rl:auth_login:{ip})
 *   - POST /auth/register: 3 requests / 300s per IP  (rl:auth_register:{ip})
 *
 * Source: docs/API_CONTRACTS.md — POST /auth/register, POST /auth/login, GET /auth/profile
 * Source: docs/RBAC.md — RBAC Matrix (Authentication Endpoints)
 * Source: docs/REDIS_SCHEMA.md — §11 Rate Limiting Counters
 * Source: docs/ENGINEERING_RULES.md — "No business logic in controllers"
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthenticatedUser, ApiSuccessResponse } from '@common/types';
import {
  LoginResponseData,
  ProfileResponseData,
  RegisterResponseData,
} from './dto/auth-response.dto';
import { RateLimitService } from './rate-limit.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  /**
   * POST /api/v1/auth/register
   *
   * Open endpoint — no authentication required.
   * Rate limited: 3 requests per 300s per IP.
   *
   * Source: docs/RBAC.md — PASSENGER ✅ DRIVER ✅ ADMIN ❌ (unauthenticated)
   * Source: docs/REDIS_SCHEMA.md — rl:auth_register:{ip} limit=3 window=300s
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
  ): Promise<ApiSuccessResponse<RegisterResponseData>> {
    await this.rateLimitService.checkRegisterLimit(ip);

    const data = await this.authService.register(dto);

    return {
      success: true,
      data,
      message: 'Account created successfully',
    };
  }

  /**
   * POST /api/v1/auth/login
   *
   * Open endpoint — no authentication required.
   * Rate limited: 5 requests per 60s per IP.
   *
   * Source: docs/RBAC.md — All roles ✅ (unauthenticated)
   * Source: docs/REDIS_SCHEMA.md — rl:auth_login:{ip} limit=5 window=60s
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
  ): Promise<ApiSuccessResponse<LoginResponseData>> {
    await this.rateLimitService.checkLoginLimit(ip);

    const data = await this.authService.login(dto);

    return {
      success: true,
      data,
      message: 'Login successful',
    };
  }

  /**
   * GET /api/v1/auth/profile
   *
   * Protected — valid access token required.
   * Returns the caller's own profile (all roles allowed).
   *
   * Source: docs/API_CONTRACTS.md — GET /auth/profile
   * Source: docs/RBAC.md — PASSENGER ✅ DRIVER ✅ ADMIN ✅ (own profile)
   */
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessResponse<ProfileResponseData>> {
    const data = await this.authService.getProfile(user.id);

    return {
      success: true,
      data,
      message: 'Profile retrieved successfully',
    };
  }
}
