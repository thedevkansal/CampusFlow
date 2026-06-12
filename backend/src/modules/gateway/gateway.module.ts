/**
 * GatewayModule — bootstraps the Socket.IO infrastructure.
 *
 * This module does NOT implement any business gateway logic.
 * It only registers the BaseGateway which handles:
 * - Connection/disconnection lifecycle
 * - Session registration in Redis
 * - Heartbeat handling
 *
 * Feature gateways (/passenger, /driver, /admin) are registered in their
 * respective feature modules (AuthModule, DriversModule, etc.)
 *
 * Source: docs/SOCKET_PROTOCOL.md
 */

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '@modules/auth/auth.module';
import { QUEUE_NAMES } from '@modules/queue/queue.constants';
import { BaseGateway } from './base.gateway';
import { PassengerGateway } from './passenger.gateway';
import { DriverGateway } from './driver.gateway';
import { RideEventsService } from './ride-events.service';

@Module({
  imports: [
    // JwtService + JwtModule needed by socket auth middleware in namespace gateways
    AuthModule,
    // location-persistence queue needed by DriverGateway to enqueue location flush jobs
    BullModule.registerQueue({ name: QUEUE_NAMES.LOCATION_PERSISTENCE }),
  ],
  providers: [BaseGateway, PassengerGateway, DriverGateway, RideEventsService],
  exports: [BaseGateway, PassengerGateway, DriverGateway, RideEventsService],
})
export class GatewayModule {}
