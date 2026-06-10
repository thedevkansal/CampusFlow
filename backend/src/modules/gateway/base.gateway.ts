/**
 * BaseGateway — connection lifecycle and heartbeat handler.
 *
 * Responsibilities (infrastructure only — no business logic):
 * - Register socket session in Redis on connect
 * - Clean up Redis session on disconnect
 * - Handle heartbeat ping/pong
 * - Emit structured error events
 *
 * JWT authentication is NOT implemented here — that is deferred to AuthModule's
 * socket middleware which will be applied per-namespace.
 *
 * Source: docs/SOCKET_PROTOCOL.md — Authentication, Room Structure, Heartbeat
 * Source: docs/REDIS_SCHEMA.md — Socket Session Mapping
 */

import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RedisService } from '@modules/redis/redis.service';

const HEARTBEAT_TIMEOUT_MS = 60_000; // 60s — see SOCKET_PROTOCOL.md
const SESSION_TTL_SECONDS = 7200;    // 2h — see REDIS_SCHEMA.md

interface HeartbeatPayload {
  clientTimestamp: string;
}

interface SocketSessionData {
  userId: string;
  role: string;
  namespace: string;
  connectedAt: string;
}

/**
 * The BaseGateway listens on all namespaces at the root level.
 * Namespace-specific gateways will be created in feature modules.
 */
@WebSocketGateway({
  cors: false, // CORS handled by RedisIoAdapter
})
export class BaseGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(BaseGateway.name);

  constructor(private readonly redisService: RedisService) {}

  async handleConnection(socket: Socket): Promise<void> {
    const socketId = socket.id;
    const namespace = socket.nsp.name;

    // User data is attached by the per-namespace auth middleware (added in AuthModule)
    // If no user data, the connection is unauthenticated — we log and disconnect
    const user = socket.data as SocketSessionData | undefined;

    if (!user?.userId) {
      // Unauthenticated connection — will be handled per-namespace by auth middleware
      this.logger.debug(`Unauthenticated socket connected: ${socketId} on ${namespace}`);
      return;
    }

    // Register session in Redis
    await this.redisService.hset(this.redisService.keys.socketSession(socketId), {
      user_id: user.userId,
      role: user.role,
      namespace,
      connected_at: new Date().toISOString(),
    });
    await this.redisService.expire(
      this.redisService.keys.socketSession(socketId),
      SESSION_TTL_SECONDS,
    );

    // Map userId → socketId for targeted emissions
    await this.redisService.set(
      this.redisService.keys.userSocket(user.userId),
      socketId,
      SESSION_TTL_SECONDS,
    );

    this.logger.debug(
      `Socket connected: ${socketId} userId=${user.userId} namespace=${namespace}`,
    );
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const socketId = socket.id;
    const user = socket.data as SocketSessionData | undefined;

    // Clean up Redis session
    await this.redisService.del(this.redisService.keys.socketSession(socketId));

    if (user?.userId) {
      // Only delete the user→socket mapping if this socket is still the active one
      const currentSocketId = await this.redisService.get(
        this.redisService.keys.userSocket(user.userId),
      );
      if (currentSocketId === socketId) {
        await this.redisService.del(this.redisService.keys.userSocket(user.userId));
      }
    }

    this.logger.debug(`Socket disconnected: ${socketId}`);
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: HeartbeatPayload,
  ): Promise<{ serverTimestamp: string; latencyMs: number }> {
    const now = Date.now();
    const clientTime = new Date(payload.clientTimestamp).getTime();
    const latencyMs = now - clientTime;

    // Reset session TTL on heartbeat activity
    const sessionKey = this.redisService.keys.socketSession(socket.id);
    await this.redisService.expire(sessionKey, SESSION_TTL_SECONDS);

    return {
      serverTimestamp: new Date(now).toISOString(),
      latencyMs,
    };
  }

  /**
   * Emit a structured error event to a specific socket.
   * Source: docs/SOCKET_PROTOCOL.md — error event spec
   */
  emitError(
    socket: Socket,
    code: string,
    message: string,
    eventName?: string,
    retryable = false,
  ): void {
    socket.emit('error', {
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      code,
      message,
      event: eventName,
      retryable,
    });
  }

  /** Health check helper — returns the number of connected sockets */
  async getConnectedSocketCount(): Promise<number> {
    const sockets = await this.server.fetchSockets();
    return sockets.length;
  }

  static readonly HEARTBEAT_TIMEOUT_MS = HEARTBEAT_TIMEOUT_MS;
}
