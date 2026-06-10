/**
 * main.ts — NestJS application bootstrap.
 *
 * Responsibilities:
 * 1. Initialize Sentry before anything else (captures early errors)
 * 2. Create the NestJS application
 * 3. Attach the Redis-backed Socket.IO adapter
 * 4. Configure Helmet (security headers)
 * 5. Configure CORS
 * 6. Set global API prefix (/api/v1)
 * 7. Enable graceful shutdown hooks
 * 8. Start listening
 *
 * Source: docs/ENGINEERING_RULES.md — Security, Performance Targets
 * Source: docs/API_CONTRACTS.md — Base URL /api/v1
 * Source: docs/SOCKET_PROTOCOL.md — Multi-Instance Deployment
 */

import 'reflect-metadata';
import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { AppConfigService } from '@common/config/app-config.service';
import { RedisIoAdapter } from '@modules/gateway/socket.adapter';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { GlobalExceptionFilter } from '@common/filters/global-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Use Winston as the NestJS logger
    bufferLogs: true,
  });

  const config = app.get(AppConfigService);
  const httpAdapterHost = app.get(HttpAdapterHost);

  // ── Step 1: Initialize Sentry ───────────────────────────────────────────────
  if (config.sentryDsn) {
    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.nodeEnv,
      tracesSampleRate: config.isProduction ? 0.1 : 1.0,
    });
  }

  // ── Step 2: Use Winston Logger ──────────────────────────────────────────────
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  // ── Step 3: Global Exception Filter ────────────────────────────────────────
  // (Also registered via APP_FILTER in AppModule — this ensures it has access
  //  to httpAdapterHost for proper response formatting)
  app.useGlobalFilters(new GlobalExceptionFilter(httpAdapterHost));

  // ── Step 4: Security Middleware ─────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: config.isProduction,
    crossOriginEmbedderPolicy: false, // Required for Socket.IO
  }));

  app.use(compression());

  // ── Step 5: CORS ────────────────────────────────────────────────────────────
  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // ── Step 6: API Prefix ──────────────────────────────────────────────────────
  // Source: docs/API_CONTRACTS.md — Base URL /api/v1
  app.setGlobalPrefix('api/v1', {
    exclude: ['health'], // Health endpoint is at root /health
  });

  // ── Step 7: Redis Socket.IO Adapter ────────────────────────────────────────
  // Source: docs/SOCKET_PROTOCOL.md — Multi-Instance Deployment
  // Source: docs/REDIS_SCHEMA.md — Dedicated pub/sub connection for Socket.IO
  const redisIoAdapter = new RedisIoAdapter(app, config);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // ── Step 8: Graceful Shutdown ───────────────────────────────────────────────
  app.enableShutdownHooks();

  // ── Step 9: Start ───────────────────────────────────────────────────────────
  const port = config.port;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`CampusFlow backend running on port ${port}`);
  logger.log(`Environment: ${config.nodeEnv}`);
  logger.log(`API: http://localhost:${port}/api/v1`);
  logger.log(`Health: http://localhost:${port}/health`);
}

void bootstrap();
