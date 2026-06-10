/**
 * PrismaService — wraps PrismaClient with NestJS lifecycle hooks.
 *
 * Responsibilities:
 * - Connect on application boot
 * - Disconnect on application shutdown (graceful shutdown)
 * - Log slow queries in development
 *
 * Source: docs/DATABASE.md — "PostgreSQL. Source of truth."
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfigService } from '@common/config/app-config.service';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: AppConfigService) {
    super({
      log:
        config.isDevelopment
          ? [
              { emit: 'event', level: 'query' },
              { emit: 'event', level: 'warn' },
              { emit: 'event', level: 'error' },
            ]
          : [
              { emit: 'event', level: 'warn' },
              { emit: 'event', level: 'error' },
            ],
      errorFormat: 'minimal',
    });
  }

  async onModuleInit(): Promise<void> {
    // Log slow queries in development (> 200ms per ENGINEERING_RULES API target)
    if (this.config.isDevelopment) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
      (this as any).$on('query', (e: { query: string; duration: number }) => {
        if (e.duration > 200) {
          this.logger.warn(`Slow query detected (${e.duration}ms): ${e.query}`);
        }
      });
    }

    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }
}
