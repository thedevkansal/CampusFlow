# Redis Schema

## Overview

This document is the authoritative specification for all Redis key patterns, data structures,
TTL strategies, and ownership in CampusFlow.

**Redis is a cache and coordination layer — it is never the source of truth.**
PostgreSQL remains the source of truth for all persistent data.
Every Redis value has a defined TTL and a PostgreSQL fallback read path.

No Redis key may be created in code that does not appear in this document.
Any new key pattern requires an update to this document before implementation.

---

## Key Naming Conventions

```
{domain}:{entity}:{identifier}[:{subkey}]
```

Rules:
- All keys use lowercase snake_case segments separated by colons
- Identifiers are always UUIDs (no integer IDs in keys)
- Avoid storing sensitive data (PII, passwords) in Redis
- All keys must have an explicit TTL unless documented as persistent (none in this system)

---

## Data Structures Reference

| Structure | Use Case |
|---|---|
| `STRING` | Flags, counters, simple values, locks (NX pattern) |
| `HASH` | Structured objects with multiple fields |
| `SORTED SET` | Ordered collections, GEO sets, priority queues |
| `LIST` | Ordered message queues (BullMQ internal use) |
| `SET` | Unique membership, tagging |

---

## Schema Catalog

---

### 1. Driver Online Status

**Key:** `driver:status:{driverId}`

**Data Type:** STRING

**Value:** Enum string — one of `ONLINE`, `OFFLINE`, `BUSY`

**TTL:** 60 seconds (sliding — reset on every `driver:location` heartbeat)

**Owner Module:** `DriversModule`

**Write Path:**
- Driver calls `POST /drivers/online` → sets `ONLINE`
- Driver calls `POST /drivers/offline` → sets `OFFLINE`, then DEL
- Matching engine assigns driver → sets `BUSY`
- Ride completes or is cancelled → sets `ONLINE`
- TTL expiry (driver disconnected without explicit offline) → key expires, driver treated as `OFFLINE`

**Read Path:**
- Matching engine reads status before including driver as a candidate
- `DriversModule` reads for profile response
- Admin dashboard reads for fleet overview

**Fallback:** Query `drivers.status` from PostgreSQL if key missing

---

### 2. Driver Real-Time Location (Hash)

**Key:** `driver:location:{driverId}`

**Data Type:** HASH

**Fields:**
```
lat        → float string   (e.g., "12.9716")
lng        → float string   (e.g., "77.5946")
heading    → float string   (degrees 0–360, optional)
speed      → float string   (km/h, optional)
updated_at → ISO 8601 string
```

**TTL:** 30 seconds (sliding — reset on every location update)

**Owner Module:** `DriversModule`

**Write Path:**
- Driver sends `PATCH /drivers/location` or socket `driver:location` event
- Written to this Hash AND to the GEO set (`drivers:geo`) atomically in the same pipeline

**Read Path:**
- Passenger socket connection reads driver location for live map
- Matching engine reads for distance calculation fallback
- `GET /rides/:id` response includes current driver location

**Fallback:** Query latest `driver_locations` row from PostgreSQL

---

### 3. Driver Geospatial Index (GEO Set)

**Key:** `drivers:geo`

**Data Type:** SORTED SET (Redis GEO — internally a sorted set scored by geohash)

**Member:** `{driverId}` (UUID string)

**Score:** Geohash of current location (managed by Redis GEO commands)

**TTL:** None on the key itself — individual members expire via scheduled cleanup

**Owner Module:** `DriversModule` (writes), `MatchingModule` (reads)

**Write Path:**
- On every `driver:location` update:
  ```
  GEOADD drivers:geo {lng} {lat} {driverId}
  ```
- On driver going offline:
  ```
  ZREM drivers:geo {driverId}
  ```
- Background job runs every 60s to remove members whose `driver:location:{driverId}` key has expired (stale drivers)

**Read Path:**
- Matching engine performs proximity search:
  ```
  GEOSEARCH drivers:geo FROMLONLAT {lng} {lat} BYRADIUS 5 km ASC COUNT 10
  ```
- Returns list of driverIds sorted by distance ascending

**Notes:**
- This is the PRIMARY geospatial lookup for all matching operations
- PostgreSQL `driver_locations` is NOT used for real-time proximity queries
- PostgreSQL is used only for historical location analytics

---

### 4. Online Driver Status Set

**Key:** `drivers:online`

**Data Type:** SET

**Members:** driverIds (UUIDs) of all currently online or busy drivers

**TTL:** None on key — members are added/removed explicitly

**Owner Module:** `DriversModule`

**Write Path:**
- Driver goes online → `SADD drivers:online {driverId}`
- Driver goes offline or status key expires → `SREM drivers:online {driverId}`

**Read Path:**
- Admin dashboard: `SCARD drivers:online` for fleet count
- Matching engine: cross-reference with GEO results

---

### 5. Active Ride State Cache

**Key:** `ride:active:{rideId}`

**Data Type:** HASH

**Fields:**
```
status        → enum string (REQUESTED | SEARCHING | ASSIGNED | ACCEPTED | ARRIVING | IN_PROGRESS)
passenger_id  → UUID string
driver_id     → UUID string (empty string if not yet assigned)
pickup_lat    → float string
pickup_lng    → float string
dest_lat      → float string
dest_lng      → float string
created_at    → ISO 8601 string
updated_at    → ISO 8601 string
```

**TTL:** 24 hours (reset on every state transition)

**Owner Module:** `RidesModule`

**Write Path:**
- Created when ride transitions from `REQUESTED` to `SEARCHING`
- Updated on every subsequent state transition
- Deleted when ride reaches a terminal state

**Read Path:**
- `GET /rides/:id` — checks cache before hitting PostgreSQL
- Socket gateway — reads current state for authorization checks
- Matching engine — reads passenger pickup coordinates

**Fallback:** Query `rides` table from PostgreSQL if key missing, then re-populate

---

### 6. Ride Matching Lock (Distributed Lock)

**Key:** `ride:lock:{rideId}`

**Data Type:** STRING

**Value:** Worker instance identifier (e.g., `worker-{hostname}-{pid}`)

**TTL:** 30 seconds

**Owner Module:** `MatchingModule`

**Write Path:**
- Acquired by matching engine worker before beginning candidate selection:
  ```
  SET ride:lock:{rideId} {workerId} NX EX 30
  ```
- Must check return value — if `nil`, another worker has the lock; abort this attempt
- Released after assignment is written to PostgreSQL

**Read Path:**
- Any worker attempting to process the same ride checks if lock exists before starting

**Notes:**
- This prevents two BullMQ workers (on different instances) from processing the same ride simultaneously
- Lock TTL of 30s must exceed the maximum expected matching operation duration
- If the worker crashes mid-operation, the lock expires and the ride can be retried

---

### 7. Driver Assignment Lock (Distributed Lock)

**Key:** `driver:lock:{driverId}`

**Data Type:** STRING

**Value:** `{rideId}` (the ride this driver is being locked to)

**TTL:** 20 seconds

**Owner Module:** `MatchingModule`

**Write Path:**
- Acquired immediately before attempting to assign a driver to a ride:
  ```
  SET driver:lock:{driverId} {rideId} NX EX 20
  ```
- Must check return value — if `nil`, driver is being assigned to another concurrent ride; skip this driver
- Released when:
  - Driver accepts the ride (lock is no longer needed — driver is committed)
  - Acceptance window times out (TIMED_OUT transition)
  - Passenger cancels before acceptance

**Read Path:**
- Matching engine checks before including a driver as a candidate

**Notes:**
- This prevents one driver from receiving two simultaneous ride assignment notifications
- Lock TTL of 20s must exceed the acceptance window of 15s

---

### 8. Ride Acceptance Deadline

**Key:** `ride:acceptance_deadline:{rideId}`

**Data Type:** STRING

**Value:** ISO 8601 timestamp of when the acceptance window closes

**TTL:** 15 seconds

**Owner Module:** `MatchingModule`

**Write Path:**
- Set immediately when `ASSIGNED` state is entered:
  ```
  SET ride:acceptance_deadline:{rideId} {isoTimestamp} EX 15
  ```
- Deleted when driver accepts (ACCEPTED transition):
  ```
  DEL ride:acceptance_deadline:{rideId}
  ```

**Read Path:**
- BullMQ timeout job checks if key still exists (if deleted, driver already accepted — abort timeout)
- Can be read by frontend to display countdown timer

---

### 9. JWT Blacklist

**Key:** `auth:blacklist:{jti}`

**Data Type:** STRING

**Value:** `1` (presence indicates blacklisted)

**TTL:** Equal to the remaining lifetime of the JWT access token at time of logout

**Owner Module:** `AuthModule`

**Write Path:**
- On `POST /auth/logout`:
  ```
  SET auth:blacklist:{jti} 1 EX {remaining_ttl_seconds}
  ```
- `jti` is the JWT ID claim (unique identifier per token)

**Read Path:**
- JWT validation middleware checks this key on **every authenticated request**:
  ```
  EXISTS auth:blacklist:{jti}
  ```
- If key exists → reject request with 401 Unauthorized

**Notes:**
- TTL is set to expire at the same time the token would have naturally expired
- This ensures the blacklist does not accumulate stale entries
- JTI must be included as a required claim in all issued JWTs

---

### 10. Refresh Token Store

**Key:** `auth:refresh:{userId}:{tokenFamily}`

**Data Type:** STRING

**Value:** Hashed refresh token value

**TTL:** 7 days

**Owner Module:** `AuthModule`

**Write Path:**
- On `POST /auth/login` or `POST /auth/refresh` — set new refresh token
- On `POST /auth/logout` — delete key

**Read Path:**
- On `POST /auth/refresh` — validate submitted token against stored value

**Notes:**
- `tokenFamily` enables refresh token rotation — each refresh generates a new family ID
- If a reused (already-rotated) refresh token is detected, all refresh tokens for that user should be invalidated (detect token theft)

---

### 11. Rate Limiting Counters

**Key:** `rl:{endpoint_slug}:{identifier}`

**Data Type:** STRING (counter via INCR)

**Value:** Integer count of requests in current window

**TTL:** Window duration in seconds

**Owner Module:** `AuthModule` / `RateLimitGuard` (shared NestJS guard)

**Write Path:**
- On every incoming request, increment counter:
  ```
  INCR rl:{endpoint_slug}:{identifier}
  EXPIRE rl:{endpoint_slug}:{identifier} {window_seconds}  (only if key is new)
  ```
  Or atomically:
  ```
  SET rl:{endpoint_slug}:{identifier} 0 NX EX {window_seconds}
  INCR rl:{endpoint_slug}:{identifier}
  ```

**Read Path:**
- After increment, compare value against limit; if exceeded → return 429

**Endpoint Slugs and Limits:**

| Endpoint Slug | Identifier | Limit | Window |
|---|---|---|---|
| `auth_login` | IP address | 5 | 60s |
| `auth_register` | IP address | 3 | 300s |
| `rides_create` | userId | 3 | 60s |
| `drivers_location` | userId | 120 | 60s |
| `ratings_create` | userId | 5 | 300s |
| `api_global` | userId | 300 | 60s |

---

### 12. Socket Session Mapping

**Key:** `socket:session:{socketId}`

**Data Type:** HASH

**Fields:**
```
user_id    → UUID string
role       → enum string (PASSENGER | DRIVER | ADMIN)
namespace  → string (/passenger | /driver | /admin)
connected_at → ISO 8601 string
```

**TTL:** 2 hours (reset on activity; deleted on disconnect)

**Owner Module:** `SocketGateway`

**Write Path:**
- On socket connection (after JWT authentication middleware):
  ```
  HSET socket:session:{socketId} user_id {uid} role {role} ...
  EXPIRE socket:session:{socketId} 7200
  ```
- On socket disconnect:
  ```
  DEL socket:session:{socketId}
  ```

**Read Path:**
- On every incoming socket event, gateway reads session to authorize the event
- `MatchingModule` reads to find the socket ID for a given userId when emitting targeted events

**Notes:**
- This is critical for multi-instance deployments — Socket.IO room membership is local to an instance, but this map is global (Redis-backed)
- Used in conjunction with `@socket.io/redis-adapter` to route cross-instance emissions

---

### 13. User-to-Socket Mapping

**Key:** `user:socket:{userId}`

**Data Type:** STRING

**Value:** `{socketId}` of the user's active connection

**TTL:** 2 hours

**Owner Module:** `SocketGateway`

**Write Path:**
- On socket connection: `SET user:socket:{userId} {socketId} EX 7200`
- On disconnect: `DEL user:socket:{userId}`

**Read Path:**
- When a server module needs to push a targeted event to a specific user (e.g., matching engine notifying a driver)

**Notes:**
- If a user has multiple connections (e.g., two browser tabs), only the most recent connection is tracked here
- Room-based emissions (preferred pattern) should be used where possible instead of direct socket ID targeting

---

### 14. BullMQ Job Deduplication

**Key:** `bull:dedup:{queueName}:{entityId}`

**Data Type:** STRING

**Value:** `{jobId}` of the already-enqueued job

**TTL:** 5 seconds (ride-matching), 30 seconds (notifications)

**Owner Module:** The module that owns the queue

**Write Path:**
- Before enqueuing a job, check if dedup key exists:
  ```
  SET bull:dedup:{queueName}:{entityId} {jobId} NX EX {ttl}
  ```
- If returns `nil` → job already queued, skip enqueue
- If returns `OK` → enqueue the job

**Read Path:**
- Checked inline before every job enqueue call

**Specific Dedup Keys:**

| Key | TTL | Purpose |
|---|---|---|
| `bull:dedup:ride-matching:{rideId}` | 5s | Prevent duplicate matching jobs |
| `bull:dedup:notifications:{userId}:{notifType}` | 30s | Prevent duplicate notification sends |
| `bull:dedup:analytics:{rideId}` | 60s | Prevent duplicate analytics ingestion |

---

### 15. Driver Performance Counters

**Key:** `driver:timeout_count:{driverId}`

**Data Type:** STRING (counter)

**Value:** Integer count of acceptance timeouts in rolling 24h window

**TTL:** 24 hours (reset daily)

**Owner Module:** `MatchingModule`

**Write Path:**
- Incremented on `TIMED_OUT` transition for a driver

**Read Path:**
- Matching engine reads as part of acceptance rate calculation
- Admin dashboard reads for driver performance reporting

---

**Key:** `driver:cancellation_count:{driverId}`

**Data Type:** STRING (counter)

**Value:** Integer count of driver-initiated cancellations in rolling 24h window

**TTL:** 24 hours

**Owner Module:** `RidesModule`

**Write Path:**
- Incremented on `DRIVER_CANCELLED` transition

**Read Path:**
- Matching engine reads as part of ranking score (penalizes high cancellers)

---

### 16. Demand Heatmap Cache

**Key:** `demand:heatmap:current`

**Data Type:** STRING (JSON blob)

**Value:** Serialized heatmap data: `[{ zone, lat, lng, demand_score }]`

**TTL:** 5 minutes

**Owner Module:** `AnalyticsModule`

**Write Path:**
- Computed by demand forecasting BullMQ job, result serialized and SET with 5m TTL

**Read Path:**
- `GET /analytics/hotspots` returns cached value if exists
- `analytics:demand_update` socket event payload sourced from this cache
- Admin dashboard polls or subscribes to this data

---

## TTL Strategy Summary

| Category | TTL Range | Reasoning |
|---|---|---|
| Driver location | 30–60s | Drivers update location frequently; stale data is worse than no data |
| Ride state cache | 24h | Rides can be long; cache should outlive the ride |
| Distributed locks | 10–30s | Must expire if the holding process crashes |
| JWT blacklist | Token remaining lifetime | Prevents accumulation of expired entries |
| Refresh tokens | 7 days | Standard refresh window |
| Rate limit counters | 60–300s | Matches rate limit window |
| Socket sessions | 2h | Typical user session length |
| Deduplication keys | 5–60s | Short enough to avoid blocking retry attempts |
| Performance counters | 24h | Rolling daily window |
| Demand cache | 5 min | Balance freshness vs. computation cost |

---

## Redis Connection Configuration

**Required connections:**
- 1 dedicated connection for BullMQ (BullMQ manages its own connection pool)
- 1 dedicated connection for Socket.IO Redis Adapter (pub/sub — cannot share with regular commands)
- 1 shared connection pool for application-level reads/writes (max pool size: 10)

**Total Redis connections at steady state:** ~12 per backend instance

**Redis persistence:**
- AOF (Append Only File) enabled for driver location and session data durability
- RDB snapshots every 15 minutes as backup

**Redis instance requirement:** Redis 7.0+ (for `GEOSEARCH` command support)
