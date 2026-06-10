# Role-Based Access Control (RBAC)

## Overview

This document defines the complete authorization matrix for CampusFlow.
Every API endpoint and every WebSocket event must be enforced against this matrix.

No endpoint may be implemented without a corresponding entry in this document.
Any new endpoint requires an RBAC entry before the code is merged.

---

## Roles

| Role | Description |
|---|---|
| `PASSENGER` | A registered user who books rides. Owns their own ride records. |
| `DRIVER` | A registered and verified driver. Owns their own assignment and location records. |
| `ADMIN` | Platform administrator. Has elevated read/write access across all resources. |

**Role assignment:**
- Role is stored in `users.role` (PostgreSQL)
- Role is embedded in the JWT payload as the `role` claim
- Role is never client-settable after registration

**Role hierarchy:**
- There is **no inheritance** between roles. ADMIN is not a superset of DRIVER or PASSENGER.
- A user can hold only one role.

---

## Authorization Enforcement Layers

```
Request → JWT Guard → RolesGuard → OwnershipGuard → Controller → Service
```

1. **JWT Guard** — Validates token signature and expiry. Rejects unauthenticated requests (401).
2. **RolesGuard** — Checks `req.user.role` against the `@Roles()` decorator on the handler. Rejects wrong role (403).
3. **OwnershipGuard** — Where marked with ownership checks, validates that the resource's owner ID matches `req.user.id`. Rejects unauthorized cross-user access (403).

---

## Symbols

| Symbol | Meaning |
|---|---|
| ✅ | Allowed |
| ❌ | Forbidden (returns 403) |
| 🔒 | Allowed with ownership check (must own the resource) |
| 👑 | Admin only |

---

## RBAC Matrix

### Authentication Endpoints

| Endpoint | Method | PASSENGER | DRIVER | ADMIN | Ownership Check | Notes |
|---|---|---|---|---|---|---|
| `/auth/register` | POST | ✅ (unauthenticated) | ✅ (unauthenticated) | ❌ | None | Admin accounts provisioned out-of-band |
| `/auth/login` | POST | ✅ (unauthenticated) | ✅ (unauthenticated) | ✅ (unauthenticated) | None | |
| `/auth/refresh` | POST | ✅ | ✅ | ✅ | Own refresh token only | |
| `/auth/logout` | POST | ✅ | ✅ | ✅ | Own session only | Blacklists current token |
| `/auth/profile` | GET | ✅ | ✅ | ✅ | Own profile | Returns role-specific profile |

---

### User Endpoints

| Endpoint | Method | PASSENGER | DRIVER | ADMIN | Ownership Check | Notes |
|---|---|---|---|---|---|---|
| `/users/profile` | GET | 🔒 | 🔒 | 👑 | `userId = req.user.id` | Passenger/Driver read own profile |
| `/users/profile` | PATCH | 🔒 | 🔒 | ❌ | `userId = req.user.id` | Admin cannot modify user profiles via this endpoint |
| `/admin/users` | GET | ❌ | ❌ | 👑 | None | Admin only — list all users |
| `/admin/users/:id` | GET | ❌ | ❌ | 👑 | None | Admin only |
| `/admin/users/:id/suspend` | PATCH | ❌ | ❌ | 👑 | None | Admin only |

---

### Driver Endpoints

| Endpoint | Method | PASSENGER | DRIVER | ADMIN | Ownership Check | Notes |
|---|---|---|---|---|---|---|
| `/drivers/register` | POST | ❌ | ✅ | ❌ | `userId = req.user.id` | Driver registers their own vehicle/profile |
| `/drivers/profile` | GET | ❌ | 🔒 | 👑 | `driverId.userId = req.user.id` | |
| `/drivers/profile` | PATCH | ❌ | 🔒 | ❌ | `driverId.userId = req.user.id` | |
| `/drivers/online` | POST | ❌ | 🔒 | ❌ | `driverId.userId = req.user.id` | |
| `/drivers/offline` | POST | ❌ | 🔒 | ❌ | `driverId.userId = req.user.id` | |
| `/drivers/location` | PATCH | ❌ | 🔒 | ❌ | `driverId.userId = req.user.id` | Rate limited: 120/min |
| `/drivers/rides` | GET | ❌ | 🔒 | 👑 | `driverId.userId = req.user.id` | Driver sees own history; Admin sees any |
| `/drivers/earnings` | GET | ❌ | 🔒 | 👑 | `driverId.userId = req.user.id` | |
| `/admin/drivers` | GET | ❌ | ❌ | 👑 | None | Admin list all drivers |
| `/admin/drivers/:id` | GET | ❌ | ❌ | 👑 | None | |
| `/admin/drivers/:id/status` | PATCH | ❌ | ❌ | 👑 | None | Suspend / reactivate driver |

---

### Ride Endpoints

| Endpoint | Method | PASSENGER | DRIVER | ADMIN | Ownership Check | Notes |
|---|---|---|---|---|---|---|
| `/rides` | POST | ✅ | ❌ | ❌ | None | Only passengers create rides |
| `/rides` | GET | 🔒 | ❌ | 👑 | `passengerId = req.user.id` | Passenger sees own rides; Admin sees all |
| `/rides/active` | GET | 🔒 | ❌ | ❌ | `passengerId = req.user.id` | Returns the current active ride if any |
| `/rides/:id` | GET | 🔒 | 🔒 | 👑 | Passenger: `ride.passenger_id = req.user.id`; Driver: must be assigned driver | |
| `/rides/:id/cancel` | POST | 🔒 | ❌ | ❌ | `ride.passenger_id = req.user.id` | Only passenger can call this endpoint; Driver cancellation is via socket |
| `/rides/:id/accept` | POST | ❌ | 🔒 | ❌ | `assignment.driver_id = req.user.driverId` | Driver must be the assigned driver |
| `/rides/:id/start` | POST | ❌ | 🔒 | ❌ | `assignment.driver_id = req.user.driverId` | |
| `/rides/:id/complete` | POST | ❌ | 🔒 | ❌ | `assignment.driver_id = req.user.driverId` | |
| `/admin/rides` | GET | ❌ | ❌ | 👑 | None | |
| `/admin/rides/:id` | GET | ❌ | ❌ | 👑 | None | |
| `/admin/rides/:id/dispute` | PATCH | ❌ | ❌ | 👑 | None | Escalate to DISPUTED state |

---

### Rating Endpoints

| Endpoint | Method | PASSENGER | DRIVER | ADMIN | Ownership Check | Notes |
|---|---|---|---|---|---|---|
| `/ratings` | POST | 🔒 | ❌ | ❌ | `ride.passenger_id = req.user.id` | Only passengers rate drivers. One rating per ride. |
| `/ratings/driver/:id` | GET | ✅ | ✅ | 👑 | None | Public driver rating is readable by all authenticated users |
| `/ratings/ride/:id` | GET | 🔒 | 🔒 | 👑 | Passenger or assigned Driver | Read rating for a specific ride |

---

### Analytics Endpoints

| Endpoint | Method | PASSENGER | DRIVER | ADMIN | Ownership Check | Notes |
|---|---|---|---|---|---|---|
| `/analytics/dashboard` | GET | ❌ | ❌ | 👑 | None | Platform-wide analytics |
| `/analytics/demand` | GET | ❌ | ✅ | 👑 | None | Drivers can see demand to decide where to go |
| `/analytics/hotspots` | GET | ❌ | ✅ | 👑 | None | |
| `/analytics/peak-hours` | GET | ❌ | ✅ | 👑 | None | |
| `/analytics/driver/:id/performance` | GET | ❌ | 🔒 | 👑 | `driverId.userId = req.user.id` | Driver sees own; Admin sees any |
| `/demand-predictions` | GET | ❌ | ✅ | 👑 | None | |

---

### Notification Endpoints

| Endpoint | Method | PASSENGER | DRIVER | ADMIN | Ownership Check | Notes |
|---|---|---|---|---|---|---|
| `/notifications` | GET | 🔒 | 🔒 | 👑 | `notification.user_id = req.user.id` | |
| `/notifications/read` | POST | 🔒 | 🔒 | ❌ | `notification.user_id = req.user.id` | Mark own notifications as read |
| `/notifications/:id` | GET | 🔒 | 🔒 | 👑 | `notification.user_id = req.user.id` | |

---

### Health Endpoint

| Endpoint | Method | PASSENGER | DRIVER | ADMIN | Ownership Check | Notes |
|---|---|---|---|---|---|---|
| `/health` | GET | ✅ (unauthenticated) | ✅ (unauthenticated) | ✅ (unauthenticated) | None | Load balancer probe — always public |

---

## WebSocket Event Authorization

All socket connections require JWT authentication during the handshake phase.
After connection, role-specific middleware enforces per-namespace access.

### Namespace Access

| Namespace | PASSENGER | DRIVER | ADMIN |
|---|---|---|---|
| `/passenger` | ✅ | ❌ | ❌ |
| `/driver` | ❌ | ✅ | ❌ |
| `/admin` | ❌ | ❌ | ✅ |

A connection to the wrong namespace must be rejected with a `connection_error` event before the socket is established.

### Socket Event Authorization Matrix

| Event | Direction | Allowed Namespace | Ownership Check |
|---|---|---|---|
| `ride:create` | Client → Server | `/passenger` | `passengerId = socket.userId` |
| `ride:cancel` | Client → Server | `/passenger` | `ride.passenger_id = socket.userId` |
| `ride:status` | Server → Client | `/passenger` | Emitted to room `passenger:{passengerId}` |
| `ride:assigned` | Server → Client | `/passenger` | Emitted to room `passenger:{passengerId}` |
| `ride:accepted` | Server → Client | `/passenger` | Emitted to room `passenger:{passengerId}` |
| `ride:started` | Server → Client | `/passenger` | Emitted to room `passenger:{passengerId}` |
| `ride:completed` | Server → Client | `/passenger` | Emitted to room `passenger:{passengerId}` |
| `ride:cancelled` | Server → Client | `/passenger` | Emitted to room `passenger:{passengerId}` |
| `ride:no_driver_found` | Server → Client | `/passenger` | Emitted to room `passenger:{passengerId}` |
| `ride:timed_out` | Server → Client | `/passenger` | Emitted to room `passenger:{passengerId}` |
| `ride:driver_arriving` | Server → Client | `/passenger` | Emitted to room `passenger:{passengerId}` |
| `driver:location_update` | Server → Client | `/passenger` | Emitted to room `ride:{rideId}` (passenger must be member) |
| `driver:online` | Client → Server | `/driver` | `driverId.userId = socket.userId` |
| `driver:offline` | Client → Server | `/driver` | `driverId.userId = socket.userId` |
| `driver:location` | Client → Server | `/driver` | `driverId.userId = socket.userId` |
| `driver:arrive` | Client → Server | `/driver` | `assignment.driver_id = socket.driverId` |
| `ride:accept` | Client → Server | `/driver` | `assignment.driver_id = socket.driverId` |
| `ride:reject` | Client → Server | `/driver` | `assignment.driver_id = socket.driverId` |
| `ride:start` | Client → Server | `/driver` | `assignment.driver_id = socket.driverId` |
| `ride:complete` | Client → Server | `/driver` | `assignment.driver_id = socket.driverId` |
| `driver:assigned_ride` | Server → Client | `/driver` | Emitted to room `driver:{driverId}` |
| `analytics:demand_update` | Server → Client | `/admin` | Broadcast to all admin connections |
| `notification:new` | Server → Client | `/passenger` or `/driver` | Emitted to room `user:{userId}` |
| `heartbeat` | Both directions | All | No ownership check |
| `error` | Server → Client | All | Emitted only to requesting socket |

---

## Ownership Check Implementation Notes

### Ride Ownership Checks

Before any ride-specific operation, the service layer must verify:

```
PASSENGER: ride.passenger_id === req.user.id
DRIVER: ride_assignments.driver_id === req.user.driverId AND assignment is active
ADMIN: no ownership check required
```

This check must happen in the **service layer**, not the controller.

### Cross-User Access Prevention

The following are explicitly forbidden and must return 403:
- Passenger A reading Passenger B's `GET /rides/:id`
- Driver A accepting a ride assigned to Driver B
- Passenger reading another passenger's notifications
- Driver reading another driver's earnings

### Field-Level Restrictions

Some endpoints return different fields depending on role:

| Resource | PASSENGER sees | DRIVER sees | ADMIN sees |
|---|---|---|---|
| `GET /rides/:id` | Full ride details + driver name/vehicle/rating | Full ride details + passenger name | Full ride details including internal fields |
| `GET /drivers/profile` | Public fields only (name, rating, vehicle) | Own full profile | Full profile including verification status |
| `GET /ratings/driver/:id` | Aggregate rating + comment | Aggregate rating + breakdown | Full rating history including raw data |

---

## Error Responses

| Scenario | HTTP Status | Error Code |
|---|---|---|
| Missing or invalid JWT | 401 | `AUTH_INVALID_TOKEN` |
| Expired JWT | 401 | `AUTH_TOKEN_EXPIRED` |
| Blacklisted JWT | 401 | `AUTH_TOKEN_REVOKED` |
| Wrong role for endpoint | 403 | `AUTHZ_ROLE_FORBIDDEN` |
| Ownership check failed | 403 | `AUTHZ_OWNERSHIP_DENIED` |
| Resource not found | 404 | `RESOURCE_NOT_FOUND` |
| Rate limit exceeded | 429 | `RATE_LIMIT_EXCEEDED` |
