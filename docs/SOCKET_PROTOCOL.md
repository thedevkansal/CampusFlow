# Socket Protocol

## Overview

This document defines the complete WebSocket communication protocol for CampusFlow.
It supersedes the original sketch-level protocol definition.

Every event, payload schema, authentication requirement, acknowledgement contract,
error handling rule, and retry behavior is specified here.

All WebSocket communication is handled via **Socket.IO** using **three isolated namespaces**.
The `@socket.io/redis-adapter` is used for multi-instance cross-server event delivery.

---

## Namespaces

The system uses three namespaces, one per role. A client must connect to exactly one
namespace matching their role. Connection to the wrong namespace is rejected at the
handshake stage.

| Namespace | Role | Purpose |
|---|---|---|
| `/passenger` | `PASSENGER` | Ride booking, status tracking, driver location |
| `/driver` | `DRIVER` | Ride assignments, location publishing, ride lifecycle |
| `/admin` | `ADMIN` | Analytics, fleet monitoring, dispute management |

Namespace enforcement is applied by a **per-namespace authentication middleware**
that reads the `role` claim from the JWT and rejects mismatched connections.

---

## Authentication

### Handshake

JWT must be provided in the Socket.IO handshake `auth` object (NOT in the query string).

```
// Client-side connection
const socket = io('/driver', {
  auth: {
    token: '<access_token>'
  }
})
```

The query string method (`?token=...`) is explicitly **forbidden** because query parameters
are logged by proxies and load balancers, which would expose bearer tokens in server logs.

### Middleware Validation (per namespace)

On every connection attempt:
1. Extract `auth.token` from handshake
2. Verify JWT signature and expiry
3. Check JWT blacklist in Redis (`auth:blacklist:{jti}`)
4. Verify role matches namespace (`PASSENGER` → `/passenger`, etc.)
5. If any check fails → reject with `connection_error` event and close socket

### Session Registration

On successful connection:
- Write `socket:session:{socketId}` to Redis (Hash, TTL: 2h) — see REDIS_SCHEMA.md
- Write `user:socket:{userId}` to Redis (STRING, TTL: 2h)
- Join room `{rolePrefix}:{userId}` (e.g., `passenger:{passengerId}`)

### Token Expiry During Active Session

- The server validates the JWT on every event emission from the client (not just on connect)
- If a JWT expires mid-session, the next client event returns an `error` event with code `AUTH_TOKEN_EXPIRED`
- The client must reconnect with a refreshed token
- The server does NOT proactively disconnect the socket on token expiry to preserve location continuity for drivers

---

## Room Structure

| Room Name | Members | Purpose |
|---|---|---|
| `passenger:{passengerId}` | Passenger socket | Receive ride updates targeted to this passenger |
| `driver:{driverId}` | Driver socket | Receive assignment notifications targeted to this driver |
| `ride:{rideId}` | Passenger + assigned Driver | Receive shared ride events (driver location updates) |
| `admin:global` | All admin sockets | Receive platform-wide analytics broadcasts |

Room join/leave is managed server-side. Clients do not emit room join/leave events.

---

## Reliability Contract

### Acknowledgements

Every event that modifies server state **must** use acknowledgement callbacks.
The server must send an ack with a result payload (success or error) before the operation is considered complete.

Events that are read-only or broadcast-only (e.g., `driver:location`, `heartbeat`) **may** omit acknowledgements.

### Reconnection Handling

- Clients must configure Socket.IO reconnection with exponential backoff (min: 1s, max: 30s, jitter: enabled)
- On reconnect, the client must re-join the appropriate rooms by emitting a `session:restore` event
- The server responds with `session:restored` containing any events missed during the disconnection window
- Missed events are fetched from PostgreSQL `ride_events` table ordered by `created_at`

### Event Ordering

- Socket.IO does not guarantee delivery order across disconnection/reconnection
- Clients must use the `created_at` timestamp in event payloads to render state correctly
- The `ride_events` table is the authoritative sequence

### Message Size Limit

- Maximum payload size per event: **64KB**
- Location update payloads: typically < 200 bytes

---

## Common Payload Conventions

Every event payload includes:

```ts
{
  eventId: string    // UUID — unique ID for this emission (for deduplication)
  timestamp: string  // ISO 8601 — server-side emission time
  // ... event-specific fields
}
```

---

## Namespace: `/passenger`

### Client → Server Events

---

#### `ride:create`

Request a new ride.

**Direction:** Client → Server

**Authentication:** Required (PASSENGER role)

**Acknowledgement:** Required

**Payload:**
```ts
{
  pickupLat: number      // -90 to 90
  pickupLng: number      // -180 to 180
  pickupAddress: string  // max 255 chars
  destLat: number        // -90 to 90
  destLng: number        // -180 to 180
  destAddress: string    // max 255 chars
}
```

**Acknowledgement Response (success):**
```ts
{
  success: true
  rideId: string    // UUID of created ride
  status: 'REQUESTED'
  estimatedWait: number  // seconds
}
```

**Acknowledgement Response (error):**
```ts
{
  success: false
  code: string      // e.g., 'RIDE_ALREADY_ACTIVE', 'INVALID_COORDINATES'
  message: string
}
```

**Server Actions:**
- Validates payload
- Checks passenger has no active ride
- Creates ride record in PostgreSQL
- Transitions ride to `SEARCHING`
- Enqueues matching job

**Error Codes:**
| Code | Meaning |
|---|---|
| `RIDE_ALREADY_ACTIVE` | Passenger already has a ride in a non-terminal state |
| `INVALID_COORDINATES` | Latitude/longitude out of valid bounds |
| `INVALID_ADDRESS` | Address exceeds max length or is empty |
| `CAMPUS_BOUNDARY_EXCEEDED` | Pickup or destination outside campus geo-fence |

---

#### `ride:cancel`

Cancel the passenger's current active ride.

**Direction:** Client → Server

**Authentication:** Required (PASSENGER role)

**Acknowledgement:** Required

**Payload:**
```ts
{
  rideId: string       // UUID
  reasonCode: string   // enum: 'CHANGED_MIND' | 'LONG_WAIT' | 'FOUND_OTHER' | 'OTHER'
  reasonText?: string  // optional, max 200 chars
}
```

**Acknowledgement Response (success):**
```ts
{
  success: true
  rideId: string
  status: 'PASSENGER_CANCELLED'
}
```

**Acknowledgement Response (error):**
```ts
{
  success: false
  code: string   // e.g., 'RIDE_NOT_CANCELLABLE', 'RIDE_NOT_FOUND'
  message: string
}
```

**Error Codes:**
| Code | Meaning |
|---|---|
| `RIDE_NOT_CANCELLABLE` | Ride is IN_PROGRESS or already in a terminal state |
| `RIDE_NOT_FOUND` | rideId does not exist |
| `AUTHZ_OWNERSHIP_DENIED` | Passenger does not own this ride |

---

#### `session:restore`

Sent by client after reconnect to request missed events.

**Direction:** Client → Server

**Authentication:** Required

**Acknowledgement:** Required

**Payload:**
```ts
{
  lastEventTimestamp: string  // ISO 8601 — timestamp of last event client received
}
```

**Acknowledgement Response:**
```ts
{
  success: true
  missedEvents: Array<{
    event: string
    payload: object
    timestamp: string
  }>
}
```

---

### Server → Client Events

---

#### `ride:status`

Generic ride status update. Emitted whenever ride state changes.

**Direction:** Server → Client

**Target:** Room `passenger:{passengerId}`

**Acknowledgement:** Not required

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  rideId: string
  status: RideStatus   // enum from RIDE_STATE_MACHINE.md
}
```

---

#### `ride:assigned`

Emitted when a driver has been assigned. Includes driver details.

**Direction:** Server → Client

**Target:** Room `passenger:{passengerId}`

**Acknowledgement:** Not required

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  rideId: string
  status: 'ASSIGNED'
  driver: {
    id: string
    name: string
    rating: number       // 1.0 – 5.0
    vehicle: {
      number: string
      model: string
      color: string
    }
    currentLat: number
    currentLng: number
    etaSeconds: number
  }
  acceptanceWindowSeconds: 15
}
```

---

#### `ride:accepted`

Emitted when the driver explicitly accepts the ride.

**Direction:** Server → Client

**Target:** Room `passenger:{passengerId}`

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  rideId: string
  status: 'ACCEPTED'
  driver: {
    id: string
    name: string
    currentLat: number
    currentLng: number
    etaSeconds: number
  }
}
```

---

#### `ride:driver_arriving`

Emitted when the driver marks themselves as arrived at pickup.

**Direction:** Server → Client

**Target:** Room `passenger:{passengerId}`

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  rideId: string
  status: 'ARRIVING'
  driver: {
    currentLat: number
    currentLng: number
  }
  message: string  // e.g., "Your driver has arrived"
}
```

---

#### `ride:started`

Emitted when the driver starts the ride (passenger in vehicle).

**Direction:** Server → Client

**Target:** Room `ride:{rideId}` (passenger + driver)

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  rideId: string
  status: 'IN_PROGRESS'
  startedAt: string   // ISO 8601
}
```

---

#### `ride:completed`

Emitted when the driver completes the ride.

**Direction:** Server → Client

**Target:** Room `ride:{rideId}` (passenger + driver)

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  rideId: string
  status: 'COMPLETED'
  completedAt: string
  fare: {
    amount: number
    currency: string   // ISO 4217, e.g., 'INR'
  }
  ratingPrompt: boolean  // true if passenger should be shown rating UI
}
```

---

#### `ride:cancelled`

Emitted when a ride is cancelled by either party.

**Direction:** Server → Client

**Target:** Room `passenger:{passengerId}` AND/OR room `driver:{driverId}`

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  rideId: string
  status: 'PASSENGER_CANCELLED' | 'DRIVER_CANCELLED'
  cancelledBy: 'PASSENGER' | 'DRIVER'
  message: string
}
```

---

#### `ride:no_driver_found`

Emitted when the matching engine finds no available driver.

**Direction:** Server → Client

**Target:** Room `passenger:{passengerId}`

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  rideId: string
  status: 'NO_DRIVER_FOUND'
  message: string   // "No drivers are currently available. Please try again shortly."
  retryAvailable: boolean
}
```

---

#### `ride:timed_out`

Emitted when the assigned driver fails to accept within the acceptance window.

**Direction:** Server → Client

**Target:** Room `passenger:{passengerId}`

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  rideId: string
  status: 'TIMED_OUT'
  message: string   // "Driver did not respond. Searching for another driver..."
  searchingAgain: boolean
}
```

---

#### `driver:location_update`

Real-time location update of the assigned driver. High-frequency event.

**Direction:** Server → Client

**Target:** Room `ride:{rideId}` (both passenger and driver receive this)

**Acknowledgement:** Not required (fire-and-forget)

**Payload:**
```ts
{
  driverId: string
  latitude: number
  longitude: number
  heading: number     // degrees 0–360
  speed: number       // km/h
  timestamp: string   // ISO 8601
}
```

---

#### `notification:new`

A new notification for the user.

**Direction:** Server → Client

**Target:** Room `user:{userId}` (shared across `/passenger` and `/driver`)

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  notificationId: string
  type: string         // e.g., 'RIDE_ASSIGNED', 'RIDE_COMPLETED', 'PROMO'
  title: string
  body: string
  rideId?: string      // if notification is ride-related
}
```

---

## Namespace: `/driver`

### Client → Server Events

---

#### `driver:online`

Mark driver as online and available.

**Direction:** Client → Server

**Authentication:** Required (DRIVER role)

**Acknowledgement:** Required

**Payload:**
```ts
{
  currentLat: number
  currentLng: number
}
```

**Acknowledgement Response:**
```ts
{
  success: true
  status: 'ONLINE'
}
```

---

#### `driver:offline`

Mark driver as offline.

**Direction:** Client → Server

**Authentication:** Required (DRIVER role)

**Acknowledgement:** Required

**Payload:** `{}` (empty)

**Acknowledgement Response:**
```ts
{
  success: true
  status: 'OFFLINE'
}
```

---

#### `driver:location`

Publish current driver location. High-frequency event.

**Direction:** Client → Server

**Authentication:** Required (DRIVER role)

**Acknowledgement:** Not required

**Rate Limit:** Maximum 2 events per second per driver (120/min)

**Payload:**
```ts
{
  driverId: string
  latitude: number    // -90 to 90
  longitude: number   // -180 to 180
  heading: number     // 0–360 degrees
  speed: number       // km/h
  timestamp: string   // ISO 8601 (client clock)
}
```

**Server Actions:**
- Validates coordinate bounds
- Updates `driver:location:{driverId}` Redis Hash
- Updates `drivers:geo` Redis GEO set
- Resets `driver:status:{driverId}` TTL to 60s
- If driver has active ride: broadcasts `driver:location_update` to room `ride:{rideId}`
- Does NOT write to PostgreSQL directly (async batch write via BullMQ)

---

#### `driver:arrive`

Driver marks themselves as arrived at the pickup location.

**Direction:** Client → Server

**Authentication:** Required (DRIVER role)

**Acknowledgement:** Required

**Payload:**
```ts
{
  rideId: string
  currentLat: number
  currentLng: number
}
```

**Acknowledgement Response (success):**
```ts
{
  success: true
  rideId: string
  status: 'ARRIVING'
}
```

---

#### `ride:accept`

Driver accepts an assigned ride.

**Direction:** Client → Server

**Authentication:** Required (DRIVER role)

**Acknowledgement:** Required

**Payload:**
```ts
{
  rideId: string
}
```

**Acknowledgement Response (success):**
```ts
{
  success: true
  rideId: string
  status: 'ACCEPTED'
  passenger: {
    name: string
    rating: number
  }
  pickup: {
    lat: number
    lng: number
    address: string
  }
  destination: {
    lat: number
    lng: number
    address: string
  }
}
```

**Acknowledgement Response (error):**
```ts
{
  success: false
  code: string   // 'RIDE_ALREADY_ACCEPTED', 'RIDE_TIMED_OUT', 'RIDE_CANCELLED'
  message: string
}
```

**Server Actions:**
- Acquires PostgreSQL row lock on `ride_assignments` via `SELECT FOR UPDATE`
- If ride is already ACCEPTED → reject with `RIDE_ALREADY_ACCEPTED`
- If ride is TIMED_OUT or CANCELLED → reject with appropriate code
- Otherwise → update state to ACCEPTED, release driver lock, cancel timeout job

---

#### `ride:reject`

Driver explicitly rejects an assigned ride.

**Direction:** Client → Server

**Authentication:** Required (DRIVER role)

**Acknowledgement:** Required

**Payload:**
```ts
{
  rideId: string
  reasonCode: string   // 'TOO_FAR' | 'NOT_AVAILABLE' | 'OTHER'
}
```

**Acknowledgement Response:**
```ts
{
  success: true
}
```

**Server Actions:**
- Updates ride back to `SEARCHING` if retry is configured
- Releases driver lock
- Re-enqueues matching job excluding this driver

---

#### `ride:start`

Driver starts the ride (passenger confirmed in vehicle).

**Direction:** Client → Server

**Authentication:** Required (DRIVER role)

**Acknowledgement:** Required

**Payload:**
```ts
{
  rideId: string
  currentLat: number
  currentLng: number
}
```

**Acknowledgement Response:**
```ts
{
  success: true
  rideId: string
  status: 'IN_PROGRESS'
}
```

---

#### `ride:complete`

Driver marks the ride as completed.

**Direction:** Client → Server

**Authentication:** Required (DRIVER role)

**Acknowledgement:** Required

**Payload:**
```ts
{
  rideId: string
  currentLat: number
  currentLng: number
}
```

**Acknowledgement Response:**
```ts
{
  success: true
  rideId: string
  status: 'COMPLETED'
  earnings: {
    amount: number
    currency: string
  }
}
```

---

### Server → Client Events

---

#### `driver:assigned_ride`

A new ride has been assigned to the driver. Acceptance window is open.

**Direction:** Server → Client

**Target:** Room `driver:{driverId}`

**Acknowledgement:** Not required (driver must send `ride:accept` or `ride:reject` to respond)

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  rideId: string
  status: 'ASSIGNED'
  acceptanceWindowSeconds: 15
  passenger: {
    name: string
    rating: number
  }
  pickup: {
    lat: number
    lng: number
    address: string
    distanceKm: number   // distance from driver's current location
    etaSeconds: number
  }
  destination: {
    lat: number
    lng: number
    address: string
  }
  estimatedFare: {
    amount: number
    currency: string
  }
}
```

---

## Namespace: `/admin`

### Server → Client Events

---

#### `analytics:demand_update`

Real-time demand heatmap update pushed to admin dashboard.

**Direction:** Server → Client

**Target:** Room `admin:global`

**Frequency:** Every 5 minutes (or on significant demand change)

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  heatmap: Array<{
    zone: string
    lat: number
    lng: number
    demandScore: number    // 0.0 – 1.0
    activeRides: number
    onlineDrivers: number
  }>
  totalActiveRides: number
  totalOnlineDrivers: number
}
```

---

## Universal Events (All Namespaces)

---

#### `heartbeat`

Bidirectional keepalive. Detects stale connections.

**Direction:** Both (client sends ping, server responds with pong)

**Frequency:** Every 25 seconds from client

**Client Payload:**
```ts
{
  clientTimestamp: string   // ISO 8601
}
```

**Server Response:**
```ts
{
  serverTimestamp: string
  latencyMs: number   // echo-based latency calculation
}
```

**Server Action:** If no heartbeat received for 60 seconds, server disconnects the socket and clears the Redis session.

---

#### `error`

Structured error event from server. Only emitted on the specific socket that caused the error.

**Direction:** Server → Client

**Payload:**
```ts
{
  eventId: string
  timestamp: string
  code: string         // machine-readable error code
  message: string      // human-readable description
  event?: string       // the client event that triggered this error, if applicable
  retryable: boolean
}
```

**Common Error Codes:**

| Code | Meaning |
|---|---|
| `AUTH_TOKEN_EXPIRED` | JWT has expired — client should refresh token and reconnect |
| `AUTH_TOKEN_REVOKED` | JWT has been blacklisted |
| `AUTHZ_NAMESPACE_MISMATCH` | Role does not match namespace |
| `AUTHZ_OWNERSHIP_DENIED` | Action on resource not owned by this user |
| `VALIDATION_FAILED` | Payload failed schema validation |
| `RATE_LIMIT_EXCEEDED` | Too many events in time window |
| `RIDE_STATE_INVALID` | Attempted state transition is not permitted |
| `SERVER_ERROR` | Unexpected internal error |

---

## Retry Behavior

| Scenario | Retry Policy |
|---|---|
| Client-side socket disconnect | Reconnect with exponential backoff (1s → 2s → 4s → max 30s) |
| Server-side `retryable: false` error | Do not retry; show error to user |
| Server-side `retryable: true` error | Retry the event once after 2 seconds |
| `ride:accept` rejected with `RIDE_ALREADY_ACCEPTED` | Do not retry; ride is gone |
| `driver:location` dropped | Not retried; next location update supersedes it |
| Acknowledgement timeout (no ack within 5s) | Retry event once; if still no ack, reconnect |

---

## Multi-Instance Deployment

All server-to-client emissions that must cross process boundaries (e.g., matching engine on instance A
needs to notify a passenger connected to instance B) must use the **Redis Adapter**:

```
npm install @socket.io/redis-adapter
```

The adapter uses Redis Pub/Sub internally. All room-targeted emissions automatically fan out to all
connected instances. Direct `socket.to(room).emit(...)` calls are all that is needed in the application code.

**Socket.IO Redis Adapter Connection:** A dedicated Redis connection (not shared with application code).
See REDIS_SCHEMA.md connection configuration section.