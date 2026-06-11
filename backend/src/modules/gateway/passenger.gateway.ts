/**
 * PassengerGateway — Socket.IO namespace /passenger.
 *
 * Responsibilities:
 *   - JWT authentication via middleware on every connection attempt
 *   - Room joins: passenger:{userId} on connect
 *   - Redis user:socket mapping maintenance
 *
 * Ride events are emitted INTO this namespace by RideEventsService.
 *
 * Source: docs/SOCKET_PROTOCOL.md — Namespace: /passenger
 * Source: docs/RBAC.md — Namespace Access: PASSENGER only
 */

import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Namespace, Socket } from 'socket.io';
import { AppConfigService } from '@common/config/app-config.service';
import { RedisService } from '@modules/redis/redis.service';
import { Role, SocketNamespace } from '@common/types';
import { buildSocketAuthMiddleware } from './socket-auth.middleware';

const SESSION_TTL = 7200; // 2h — REDIS_SCHEMA §12

@WebSocketGateway({ namespace: SocketNamespace.PASSENGER })
export class PassengerGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger(PassengerGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  afterInit(server: Namespace): void {
    server.use(
      buildSocketAuthMiddleware(this.jwtService, this.config, this.redis, Role.PASSENGER),
    );
  }

  async handleConnection(socket: Socket): Promise<void> {
    const { userId } = socket.data as { userId: string };
    await socket.join(`passenger:${userId}`);
    await socket.join(`user:${userId}`);
    await this.redis.set(this.redis.keys.userSocket(userId), socket.id, SESSION_TTL);
    this.logger.debug(`Passenger connected: userId=${userId} socketId=${socket.id}`);
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const { userId } = socket.data as { userId?: string };
    if (!userId) return;
    const current = await this.redis.get(this.redis.keys.userSocket(userId));
    if (current === socket.id) {
      await this.redis.del(this.redis.keys.userSocket(userId));
    }
    this.logger.debug(`Passenger disconnected: userId=${userId}`);
  }
}
