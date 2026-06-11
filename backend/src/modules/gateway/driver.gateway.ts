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
import { Role, SocketNamespace } from '@common/types';
import { buildSocketAuthMiddleware } from './socket-auth.middleware';
import { BaseGateway } from './base.gateway';

const SESSION_TTL = 7200;
const DRIVER_STATUS_TTL = 60;
const DRIVER_LOCATION_TTL = 30;

interface DriverLocationPayload {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
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
   * Updates Redis GEO + location hash (no DB write — use PATCH /drivers/location for that).
   * Broadcasts driver_location_updated to the passenger of the active ride.
   */
  @SubscribeMessage('driver:location')
  async handleLocation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: DriverLocationPayload,
  ): Promise<void> {
    const { driverId } = socket.data as { driverId: string };

    // Update GEO set (longitude first — Redis GEO convention)
    await this.redis.geoAdd(
      this.redis.keys.driversGeo(),
      payload.longitude,
      payload.latitude,
      driverId,
    );

    // Update location hash + reset TTL
    const locationKey = this.redis.keys.driverLocation(driverId);
    await this.redis.hset(locationKey, {
      lat: payload.latitude.toString(),
      lng: payload.longitude.toString(),
      ...(payload.heading !== undefined && { heading: payload.heading.toString() }),
      ...(payload.speed !== undefined && { speed: payload.speed.toString() }),
      updated_at: new Date().toISOString(),
    });
    await this.redis.expire(locationKey, DRIVER_LOCATION_TTL);

    // Slide driver:status TTL on every location heartbeat
    const status = await this.redis.get(this.redis.keys.driverStatus(driverId));
    if (status) {
      await this.redis.set(this.redis.keys.driverStatus(driverId), status, DRIVER_STATUS_TTL);
    }

    // Broadcast to passenger of active ride
    const activeRideRaw = await this.redis.get(this.redis.keys.driverActiveRide(driverId));
    if (!activeRideRaw) return;

    const { rideId } = JSON.parse(activeRideRaw) as {
      rideId: string;
      passengerId: string;
    };

    this.baseGateway.server
      .of(SocketNamespace.PASSENGER)
      .to(`ride:${rideId}`)
      .emit('driver_location_updated', {
        driverId,
        latitude: payload.latitude,
        longitude: payload.longitude,
        heading: payload.heading ?? null,
        speed: payload.speed ?? null,
        timestamp: new Date().toISOString(),
      });
  }
}
