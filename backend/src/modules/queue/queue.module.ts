/**
 * QueueModule — registers all BullMQ queues.
 *
 * All 5 queues defined in docs/MATCHING_ENGINE.md are registered here.
 * Workers are registered per-feature module (not here) to keep queue
 * infrastructure separate from business logic.
 *
 * Source: docs/MATCHING_ENGINE.md — "BullMQ Queue Design"
 * Source: docs/REDIS_SCHEMA.md — "Redis Connection Configuration" (BullMQ uses separate connection)
 */

import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigModule } from '@common/config/config.module';
import { AppConfigService } from '@common/config/app-config.service';
import { QUEUE_NAMES } from './queue.constants';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: {
          // BullMQ uses its own dedicated connection — not the application Redis pool
          lazyConnect: false,
          maxRetriesPerRequest: null, // BullMQ requirement for blocking commands
          enableReadyCheck: false,    // BullMQ requirement
          ...(parseRedisUrl(config.redisUrl)),
        },
        defaultJobOptions: {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      }),
    }),

    // Register all queues — workers are added per feature module
    BullModule.registerQueue(
      { name: QUEUE_NAMES.RIDE_MATCHING },
      { name: QUEUE_NAMES.NOTIFICATIONS },
      { name: QUEUE_NAMES.ANALYTICS_INGESTION },
      { name: QUEUE_NAMES.DEMAND_FORECASTING },
      { name: QUEUE_NAMES.LOCATION_PERSISTENCE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}

/**
 * Parse a Redis URL into ioredis-compatible connection options.
 * BullMQ requires individual host/port/password — not a URL string.
 */
function parseRedisUrl(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
} {
  const parsed = new URL(url);

  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname
      ? parseInt(parsed.pathname.slice(1) || '0', 10)
      : 0,

    ...(parsed.protocol === 'rediss:'
      ? {
          tls: {},
        }
      : {}),
  };
}
