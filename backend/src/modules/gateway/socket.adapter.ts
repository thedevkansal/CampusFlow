/**
 * RedisIoAdapter — wraps the default Socket.IO adapter with the Redis Adapter
 * for multi-instance support.
 *
 * This uses a DEDICATED Redis connection for pub/sub — separate from the
 * application pool and the BullMQ connection. Three total Redis connections
 * per instance as documented in docs/REDIS_SCHEMA.md.
 *
 * Source: docs/SOCKET_PROTOCOL.md — "Multi-Instance Deployment"
 * Source: docs/REDIS_SCHEMA.md — "Redis Connection Configuration"
 */

import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions, Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { INestApplication, Logger } from '@nestjs/common';
import { AppConfigService } from '@common/config/app-config.service';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor!: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplication,
    private readonly config: AppConfigService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const url = this.config.redisUrl;

    // Two dedicated connections: one for pub, one for sub
    const pubClient = new Redis(url, { lazyConnect: false,
      tls: url.startsWith('rediss://') ? {} : undefined,
     });
    const subClient = pubClient.duplicate();

    await Promise.all([
      new Promise<void>((resolve) => pubClient.once('ready', resolve)),
      new Promise<void>((resolve) => subClient.once('ready', resolve)),
    ]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('Redis Socket.IO adapter connected');
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      // Disable cors on the socket server itself; it's handled by the adapter
      cors: {
        origin: this.config.corsOrigins,
        credentials: true,
      },
      // Use WebSocket only in production for lower overhead
      transports: this.config.isProduction ? ['websocket'] : ['websocket', 'polling'],
      // Connection state recovery (Socket.IO v4.6+ feature)
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true,
      },
    }) as Server;

    server.adapter(this.adapterConstructor);

    return server;
  }
}
