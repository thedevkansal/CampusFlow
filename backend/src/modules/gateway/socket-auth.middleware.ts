/**
 * buildSocketAuthMiddleware — factory that returns a Socket.IO middleware function.
 *
 * Applied in each namespace gateway's afterInit() to reject connections before
 * any event handler runs. Validates:
 *   1. Token present in socket.handshake.auth.token
 *   2. JWT signature + expiry (via JwtService)
 *   3. JWT not on the blacklist (Redis auth:blacklist:{jti})
 *   4. Role matches the namespace's required role
 *
 * On success: sets socket.data.userId, socket.data.role, socket.data.driverId
 * On failure: calls next(Error) — Socket.IO disconnects the socket
 *
 * Source: docs/SOCKET_PROTOCOL.md — Authentication
 * Source: docs/RBAC.md — Namespace Access matrix
 */

import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { AppConfigService } from '@common/config/app-config.service';
import { RedisService } from '@modules/redis/redis.service';
import { Role } from '@common/types';
import { JwtAccessPayload } from '@modules/auth/strategies/jwt-access.strategy';

export type SocketMiddleware = (
  socket: Socket,
  next: (err?: Error) => void,
) => void;

export function buildSocketAuthMiddleware(
  jwtService: JwtService,
  _config: AppConfigService,
  redis: RedisService,
  requiredRole: Role,
): SocketMiddleware {
  return async (socket: Socket, next: (err?: Error) => void) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (!token) {
      next(new Error('AUTH_REQUIRED'));
      return;
    }

    try {
      const payload = jwtService.verify<JwtAccessPayload>(token);

      if (payload.role !== requiredRole) {
        next(new Error('AUTHZ_NAMESPACE_MISMATCH'));
        return;
      }

      const blacklisted = await redis.exists(redis.keys.jwtBlacklist(payload.jti));
      if (blacklisted) {
        next(new Error('AUTH_TOKEN_REVOKED'));
        return;
      }

      socket.data.userId = payload.sub;
      socket.data.role = payload.role;
      socket.data.driverId = payload.driverId;

      next();
    } catch {
      next(new Error('AUTH_INVALID_TOKEN'));
    }
  };
}
