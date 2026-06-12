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
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Namespace, Socket } from 'socket.io';
import { AppConfigService } from '@common/config/app-config.service';
import { RedisService } from '@modules/redis/redis.service';
import { PrismaService } from '@prisma/prisma.service';
import { Role, SocketNamespace } from '@common/types';
import { buildSocketAuthMiddleware } from './socket-auth.middleware';

const SESSION_TTL = 7200; // 2h — REDIS_SCHEMA §12

interface SessionRestorePayload {
  lastEventTimestamp: string;
}

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
    private readonly prisma: PrismaService,
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

  /**
   * Session restore — client sends after reconnect to fetch missed events.
   * SOCKET_PROTOCOL.md §Reconnection Handling
   */
  @SubscribeMessage('session:restore')
  async handleSessionRestore(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: SessionRestorePayload,
  ): Promise<{ success: boolean; missedEvents: Array<{ event: string; payload: object; timestamp: string }> }> {
    const { userId } = socket.data as { userId: string };

    const since = payload?.lastEventTimestamp
      ? new Date(payload.lastEventTimestamp)
      : new Date(Date.now() - 5 * 60 * 1000);

    // Find active ride for this passenger from ride:active cache or DB
    const activeRide = await this.prisma.ride.findFirst({
      where: {
        passengerId: userId,
        status: { notIn: ['COMPLETED', 'PASSENGER_CANCELLED', 'DRIVER_CANCELLED', 'NO_DRIVER_FOUND', 'TIMED_OUT'] },
      },
      orderBy: { requestedAt: 'desc' },
    });

    if (!activeRide) {
      return { success: true, missedEvents: [] };
    }

    const events = await this.prisma.rideEvent.findMany({
      where: { rideId: activeRide.id, createdAt: { gt: since } },
      orderBy: { createdAt: 'asc' },
    });

    const missedEvents = events.map((e: { eventType: string; payload: unknown; createdAt: Date }) => ({
      event: e.eventType.toLowerCase(),
      payload: (e.payload as object) ?? {},
      timestamp: e.createdAt.toISOString(),
    }));

    // Rejoin ride room if ride is still active
    if (activeRide.id) {
      await socket.join(`ride:${activeRide.id}`);
    }

    return { success: true, missedEvents };
  }
}
