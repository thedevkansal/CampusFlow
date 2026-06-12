/**
 * DriverGateway — Socket.IO namespace /driver.
 *
 * Responsibilities:
 *   - JWT authentication (DRIVER role only)
 *   - Room joins: driver:{driverId} on connect
 *   - driver:location event — high-frequency location updates from driver clients
 *     Updates Redis GEO + location hash and broadcasts driver_location_updated
 *     to the passenger in the active ride (via /passenger namespace)
 *
 * DriversService REST path (PATCH /drivers/location) remains for DB persistence.
 * This socket path is the realtime broadcast path — no DB write.
 *
 * Source: docs/SOCKET_PROTOCOL.md — Namespace: /driver, driver:location event
 */

import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
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
import { JOB_NAMES, QUEUE_NAMES } from '@modules/queue/queue.constants';
import { buildSocketAuthMiddleware } from './socket-auth.middleware';
import { BaseGateway } from './base.gateway';

const SESSION_TTL = 7200;
const DRIVER_STATUS_TTL = 60;
const DRIVER_LOCATION_TTL = 30;
/** Rate limit: 120 events / 60s = 2/sec — SOCKET_PROTOCOL.md driver:location */
const LOCATION_RATE_LIMIT_WINDOW_S = 60;
const LOCATION_RATE_LIMIT_MAX = 120;

interface DriverLocationPayload {
  driverId?: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  timestamp?: string;
}

interface SessionRestorePayload {
  lastEventTimestamp: string;
}

@WebSocketGateway({ namespace: SocketNamespace.DRIVER })
export class DriverGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger(DriverGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
    private readonly baseGateway: BaseGateway,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.LOCATION_PERSISTENCE)
    private readonly locationQueue: Queue,
  ) {}

  afterInit(server: Namespace): void {
    server.use(
      buildSocketAuthMiddleware(this.jwtService, this.config, this.redis, Role.DRIVER),
    );
  }

  async handleConnection(socket: Socket): Promise<void> {
    const { userId, driverId } = socket.data as { userId: string; driverId?: string };

    if (!driverId) {
      this.logger.warn(`Driver socket missing driverId claim, disconnecting: socketId=${socket.id}`);
      socket.disconnect(true);
      return;
    }

    await socket.join(`driver:${driverId}`);
    await socket.join(`user:${userId}`);
    await this.redis.set(this.redis.keys.userSocket(userId), socket.id, SESSION_TTL);
    this.logger.debug(`Driver connected: driverId=${driverId} socketId=${socket.id}`);
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const { userId } = socket.data as { userId?: string };
    if (!userId) return;
    const current = await this.redis.get(this.redis.keys.userSocket(userId));
    if (current === socket.id) {
      await this.redis.del(this.redis.keys.userSocket(userId));
    }
  }

  /**
   * High-frequency location event from driver client.
   * Rate limited: 120/min per driver (= 2/sec) — SOCKET_PROTOCOL.md.
   * Updates Redis GEO + location hash, enqueues async DB persistence,
   * broadcasts driver:location_update to ride:{rideId} room.
   */
  @SubscribeMessage('driver:location')
  async handleLocation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: DriverLocationPayload,
  ): Promise<void> {
    const { driverId, userId } = socket.data as { driverId: string; userId: string };

    // Validate coordinate bounds — SOCKET_PROTOCOL.md driver:location
    if (
      typeof payload.latitude !== 'number' ||
      typeof payload.longitude !== 'number' ||
      payload.latitude < -90 || payload.latitude > 90 ||
      payload.longitude < -180 || payload.longitude > 180
    ) {
      this.baseGateway.emitError(socket, 'VALIDATION_FAILED', 'Invalid coordinates', 'driver:location');
      return;
    }

    // Rate limit — 120 events / 60s per driver (REDIS_SCHEMA §11)
    const rlKey = this.redis.keys.rateLimitCounter('socket_location', userId);
    const count = await this.redis.incr(rlKey);
    if (count === 1) {
      await this.redis.expire(rlKey, LOCATION_RATE_LIMIT_WINDOW_S);
    }
    if (count > LOCATION_RATE_LIMIT_MAX) {
      this.baseGateway.emitError(socket, 'RATE_LIMIT_EXCEEDED', 'Location update rate limit exceeded', 'driver:location');
      return;
    }

    const now = new Date().toISOString();

    // Update GEO set (longitude first — Redis GEO convention)
    await this.redis.geoAdd(this.redis.keys.driversGeo(), payload.longitude, payload.latitude, driverId);

    // Update location hash + reset TTL (REDIS_SCHEMA §2)
    const locationKey = this.redis.keys.driverLocation(driverId);
    await this.redis.hset(locationKey, {
      lat: payload.latitude.toString(),
      lng: payload.longitude.toString(),
      ...(payload.heading !== undefined && { heading: payload.heading.toString() }),
      ...(payload.speed !== undefined && { speed: payload.speed.toString() }),
      updated_at: now,
    });
    await this.redis.expire(locationKey, DRIVER_LOCATION_TTL);

    // Slide driver:status TTL on every location heartbeat (REDIS_SCHEMA §1)
    const status = await this.redis.get(this.redis.keys.driverStatus(driverId));
    if (status) {
      await this.redis.set(this.redis.keys.driverStatus(driverId), status, DRIVER_STATUS_TTL);
    }

    // Enqueue async DB persistence — do NOT write to PostgreSQL directly (ARCHITECTURE)
    void this.locationQueue.add(JOB_NAMES.FLUSH_DRIVER_LOCATION, {
      driverId,
      latitude: payload.latitude,
      longitude: payload.longitude,
      heading: payload.heading,
      speed: payload.speed,
      timestamp: now,
    });

    // Broadcast to ride room if driver has an active ride (SOCKET_PROTOCOL.md driver:location_update)
    const activeRideRaw = await this.redis.get(this.redis.keys.driverActiveRide(driverId));
    if (!activeRideRaw) return;

    const { rideId } = JSON.parse(activeRideRaw) as { rideId: string; passengerId: string };

    const locationPayload = {
      driverId,
      latitude: payload.latitude,
      longitude: payload.longitude,
      heading: payload.heading ?? 0,
      speed: payload.speed ?? 0,
      timestamp: now,
    };

    // Emit to ride:{rideId} in both namespaces — both passenger and driver receive this
    this.baseGateway.server.of(SocketNamespace.PASSENGER).to(`ride:${rideId}`).emit('driver:location_update', locationPayload);
    this.baseGateway.server.of(SocketNamespace.DRIVER).to(`ride:${rideId}`).emit('driver:location_update', locationPayload);
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
    const { driverId } = socket.data as { driverId: string };

    const since = payload?.lastEventTimestamp
      ? new Date(payload.lastEventTimestamp)
      : new Date(Date.now() - 5 * 60 * 1000);

    // Find active ride for this driver via Redis
    const activeRideRaw = await this.redis.get(this.redis.keys.driverActiveRide(driverId));
    if (!activeRideRaw) {
      return { success: true, missedEvents: [] };
    }

    const { rideId } = JSON.parse(activeRideRaw) as { rideId: string };

    const events = await this.prisma.rideEvent.findMany({
      where: { rideId, createdAt: { gt: since } },
      orderBy: { createdAt: 'asc' },
    });

    const missedEvents = events.map((e: { eventType: string; payload: unknown; createdAt: Date }) => ({
      event: e.eventType.toLowerCase(),
      payload: (e.payload as object) ?? {},
      timestamp: e.createdAt.toISOString(),
    }));

    return { success: true, missedEvents };
  }
}
