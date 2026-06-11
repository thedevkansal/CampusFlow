/**
 * RideEventsService — application-level event layer between business logic and sockets.
 *
 * All Socket.IO emissions for ride lifecycle changes go through this service.
 * Business services (RidesService, MatchingProcessor, DriversService) call these
 * typed methods — they never touch the socket layer directly.
 *
 * Pattern:
 *   RidesService → RideEventsService → baseGateway.server.of('/ns') → clients
 *
 * Uses the root Server (via BaseGateway) to reach any namespace, which is correct
 * with the @socket.io/redis-adapter: room emissions are routed cross-instance.
 *
 * Source: docs/SOCKET_PROTOCOL.md — Server → Client events
 */

import { Injectable, Logger } from '@nestjs/common';
import { BaseGateway } from './base.gateway';
import { RedisService } from '@modules/redis/redis.service';
import { SocketNamespace } from '@common/types';

const ACTIVE_RIDE_TTL = 86400; // 24h

@Injectable()
export class RideEventsService {
  private readonly logger = new Logger(RideEventsService.name);

  constructor(
    private readonly baseGateway: BaseGateway,
    private readonly redis: RedisService,
  ) {}

  // ── Namespace accessors ───────────────────────────────────────────────────

  private get passengerNsp() {
    return this.baseGateway.server.of(SocketNamespace.PASSENGER);
  }

  private get driverNsp() {
    return this.baseGateway.server.of(SocketNamespace.DRIVER);
  }

  // ── Ride lifecycle emissions ──────────────────────────────────────────────

  /**
   * Emitted when matching engine assigns a driver (SEARCHING → ASSIGNED).
   * Also:
   *   - Stores driver:active_ride cache for location broadcasts
   *   - Joins the passenger socket into ride:{rideId} room for location tracking
   */
  async emitRideAssigned(
    rideId: string,
    passengerId: string,
    driverId: string,
  ): Promise<void> {
    // Store active ride info — used by location broadcast path
    await this.redis.set(
      this.redis.keys.driverActiveRide(driverId),
      JSON.stringify({ rideId, passengerId }),
      ACTIVE_RIDE_TTL,
    );

    // Join passenger socket to ride room so they receive driver_location_updated
    const passengerSocketId = await this.redis.get(
      this.redis.keys.userSocket(passengerId),
    );
    if (passengerSocketId) {
      await this.passengerNsp.in(passengerSocketId).socketsJoin(`ride:${rideId}`);
    }

    const ts = new Date().toISOString();
    this.passengerNsp
      .to(`passenger:${passengerId}`)
      .emit('ride_assigned', { rideId, status: 'ASSIGNED', driverId, timestamp: ts });

    this.driverNsp
      .to(`driver:${driverId}`)
      .emit('ride_assigned', { rideId, status: 'ASSIGNED', passengerId, timestamp: ts });

    this.logger.debug(`ride_assigned emitted: rideId=${rideId}`);
  }

  /**
   * Emitted when driver accepts the ride (ASSIGNED → ACCEPTED).
   */
  emitRideAccepted(rideId: string, passengerId: string, driverId: string): void {
    const ts = new Date().toISOString();
    this.passengerNsp
      .to(`passenger:${passengerId}`)
      .emit('ride_accepted', { rideId, status: 'ACCEPTED', driverId, timestamp: ts });
  }

  /**
   * Emitted on intermediate state changes: ARRIVING, IN_PROGRESS.
   * Notifies both passenger and driver.
   */
  emitRideUpdated(
    rideId: string,
    passengerId: string,
    driverId: string,
    status: string,
  ): void {
    const payload = { rideId, status, timestamp: new Date().toISOString() };
    this.passengerNsp.to(`passenger:${passengerId}`).emit('ride_updated', payload);
    this.driverNsp.to(`driver:${driverId}`).emit('ride_updated', payload);
  }

  /**
   * Emitted when a ride is cancelled by either party.
   * Clears driver:active_ride cache.
   */
  async emitRideCancelled(
    rideId: string,
    passengerId: string,
    driverId: string | null,
    cancelledBy: 'PASSENGER' | 'DRIVER',
    status: string,
  ): Promise<void> {
    const payload = { rideId, status, cancelledBy, timestamp: new Date().toISOString() };
    this.passengerNsp.to(`passenger:${passengerId}`).emit('ride_cancelled', payload);
    if (driverId) {
      this.driverNsp.to(`driver:${driverId}`).emit('ride_cancelled', payload);
      await this.redis.del(this.redis.keys.driverActiveRide(driverId));
    }
    this.logger.debug(`ride_cancelled emitted: rideId=${rideId} by=${cancelledBy}`);
  }

  /**
   * Emitted when driver completes the ride (IN_PROGRESS → COMPLETED).
   * Clears driver:active_ride cache.
   */
  async emitRideCompleted(
    rideId: string,
    passengerId: string,
    driverId: string,
  ): Promise<void> {
    const payload = { rideId, status: 'COMPLETED', timestamp: new Date().toISOString() };
    this.passengerNsp.to(`passenger:${passengerId}`).emit('ride_completed', payload);
    this.driverNsp.to(`driver:${driverId}`).emit('ride_completed', payload);
    await this.redis.del(this.redis.keys.driverActiveRide(driverId));
    this.logger.debug(`ride_completed emitted: rideId=${rideId}`);
  }

  /**
   * Emitted when driver's location changes during an active ride (REST path).
   * Socket path broadcasts directly in DriverGateway.handleLocation.
   */
  emitDriverLocationUpdated(
    rideId: string,
    driverId: string,
    latitude: number,
    longitude: number,
  ): void {
    this.passengerNsp.to(`ride:${rideId}`).emit('driver_location_updated', {
      driverId,
      latitude,
      longitude,
      timestamp: new Date().toISOString(),
    });
  }
}
