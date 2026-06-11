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
import { AuthModule } from '@modules/auth/auth.module';
import { BaseGateway } from './base.gateway';
import { PassengerGateway } from './passenger.gateway';
import { DriverGateway } from './driver.gateway';
import { RideEventsService } from './ride-events.service';

@Module({
  imports: [
    // JwtService + JwtModule needed by socket auth middleware in namespace gateways
    AuthModule,
  ],
  providers: [BaseGateway, PassengerGateway, DriverGateway, RideEventsService],
  exports: [BaseGateway, PassengerGateway, DriverGateway, RideEventsService],
})
export class GatewayModule {}
