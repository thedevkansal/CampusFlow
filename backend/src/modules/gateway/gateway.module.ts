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
import { BaseGateway } from './base.gateway';

@Module({
  providers: [BaseGateway],
  exports: [BaseGateway],
})
export class GatewayModule {}
