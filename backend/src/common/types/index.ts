/**
 * Shared TypeScript types and enums used across modules.
 * These mirror the Prisma enums so they can be used in service/controller
 * layers without importing from @prisma/client directly.
 *
 * Source: docs/RBAC.md, docs/RIDE_STATE_MACHINE.md
 */

// ─── Roles (mirrors UserRole enum in Prisma schema) ──────────────────────────

export enum Role {
  PASSENGER = 'PASSENGER',
  DRIVER = 'DRIVER',
  ADMIN = 'ADMIN',
}

// ─── Ride Status (mirrors RideStatus enum in Prisma schema) ──────────────────

export enum RideStatus {
  REQUESTED = 'REQUESTED',
  SEARCHING = 'SEARCHING',
  ASSIGNED = 'ASSIGNED',
  ACCEPTED = 'ACCEPTED',
  ARRIVING = 'ARRIVING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  NO_DRIVER_FOUND = 'NO_DRIVER_FOUND',
  TIMED_OUT = 'TIMED_OUT',
  PASSENGER_CANCELLED = 'PASSENGER_CANCELLED',
  DRIVER_CANCELLED = 'DRIVER_CANCELLED',
  DISPUTED = 'DISPUTED',
}

// Terminal states — once reached, no further transitions are allowed
export const TERMINAL_RIDE_STATES = new Set<RideStatus>([
  RideStatus.COMPLETED,
  RideStatus.NO_DRIVER_FOUND,
  RideStatus.TIMED_OUT,
  RideStatus.PASSENGER_CANCELLED,
  RideStatus.DRIVER_CANCELLED,
  RideStatus.DISPUTED,
]);

// ─── Driver Status ────────────────────────────────────────────────────────────

export enum DriverStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  BUSY = 'BUSY',
}

// ─── Socket Namespaces (matches docs/SOCKET_PROTOCOL.md) ─────────────────────

export enum SocketNamespace {
  PASSENGER = '/passenger',
  DRIVER = '/driver',
  ADMIN = '/admin',
}

// ─── API Response Shapes ──────────────────────────────────────────────────────

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  message: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  code: string;
}

// ─── Authenticated Request ────────────────────────────────────────────────────

export interface AuthenticatedUser {
  id: string;
  role: Role;
  driverId?: string; // only present if role === DRIVER
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
