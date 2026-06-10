/**
 * HealthController — exposes GET /health
 *
 * Checks:
 * 1. Application is running (always passes if this code executes)
 * 2. PostgreSQL connectivity via Prisma
 * 3. Redis connectivity via RedisService.ping()
 *
 * Source: docs/RBAC.md — "GET /health — unauthenticated, all roles"
 * Source: docs/ENGINEERING_RULES.md — "High availability. Observability and monitoring."
 */

import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { RedisService } from '@modules/redis/redis.service';
import { PrismaService } from '@prisma/prisma.service';
import { ApiSuccessResponse } from '@common/types';

interface HealthCheckData {
  status: string;
  checks: Record<string, HealthIndicatorResult[string]>;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @HealthCheck()
  async check(): Promise<ApiSuccessResponse<HealthCheckData>> {
    const result = await this.health.check([
      // PostgreSQL check
      async () => this.prismaHealth.pingCheck('postgres', this.prisma),

      // Redis check — custom indicator
      async (): Promise<HealthIndicatorResult> => {
        const isAlive = await this.redis.ping();
        return {
          redis: {
            status: isAlive ? 'up' : 'down',
          },
        };
      },
    ]);

    return {
      success: true,
      data: {
        status: result.status,
        checks: result.details,
      },
      message: 'Health check complete',
    };
  }
}
