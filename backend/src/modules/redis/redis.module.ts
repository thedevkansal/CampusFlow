/**
 * RedisModule — global module exposing RedisService.
 *
 * This module provides the application-level Redis client.
 * BullMQ and Socket.IO adapter manage their own separate connections.
 *
 * Source: docs/REDIS_SCHEMA.md — "Redis Connection Configuration"
 */

import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
