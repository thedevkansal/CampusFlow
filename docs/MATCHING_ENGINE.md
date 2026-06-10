# Driver Matching Engine

## Overview

This document defines the complete design of the CampusFlow matching engine.
It supersedes the original sketch-level design.

The matching engine is responsible for:
- Discovering nearby available drivers using Redis GEO
- Ranking candidates by a weighted scoring algorithm
- Assigning the optimal driver while preventing duplicate assignment
- Managing the driver acceptance window
- Handling race conditions with PostgreSQL row-level locking and Redis distributed locks
- Recovering from failures via BullMQ retry policies

The matching engine runs as a **BullMQ worker within the NestJS monolith** (not a separate process).
It consumes jobs from the `ride-matching` queue.

---

## Architecture Decision: Same Process vs. Separate Service

The matching engine is co-located in the main NestJS backend process.

Rationale:
- Simplifies deployment at current scale (500 concurrent users)
- Shares database connection pool (Prisma) with the main application
- Shares Redis connection pool with the main application
- BullMQ workers can be run in a separate thread via `workerThreads: true` to avoid blocking

Future: If the matching engine needs independent scaling, it can be extracted to a separate NestJS application
with its own Dockerfile. The interface boundary is the `ride-matching` BullMQ queue — no code changes required.

---

## BullMQ Queue Design

### Queue Taxonomy

| Queue Name | Priority | Concurrency | Use Case |
|---|---|---|---|
| `ride-matching` | CRITICAL | 5 per instance | Driver candidate selection and assignment |
| `notifications` | HIGH | 20 per instance | Push notifications, SMS, email |
| `analytics-ingestion` | MEDIUM | 10 per instance | Ride analytics event storage |
| `demand-forecasting` | LOW | 2 per instance | Background demand prediction computation |
| `location-persistence` | LOW | 10 per instance | Async flush of driver locations to PostgreSQL |

### `ride-matching` Queue Configuration

```
Queue name:     ride-matching
Concurrency:    5 (per instance)
Priority:       1 (highest)
Attempts:       3
Backoff:        exponential, initial delay 1000ms
Remove on complete: after 100 completed jobs
Remove on fail: after 50 failed jobs
Job deduplication: via Redis NX key (see REDIS_SCHEMA.md bull:dedup:ride-matching:{rideId})
```

### Job Payload Schema

```ts
{
  rideId: string           // UUID
  passengerId: string      // UUID
  pickupLat: number
  pickupLng: number
  requestedAt: string      // ISO 8601
  attemptNumber: number    // 1-indexed; used for re-match flow
  excludeDriverIds: string[] // previously rejected/timed-out drivers for this ride
}
```

### Job ID Convention

Job ID format: `matching:{rideId}:{attemptNumber}`

This enables targeted cancellation (e.g., when passenger cancels before assignment).

### Acceptance Timeout Job

A separate delayed job is enqueued on the `ride-matching` queue when a driver is assigned.

Job name: `acceptance-timeout`
Job ID: `acceptance-timeout:{rideId}`
Delay: 15,000ms (15 seconds)
Payload: `{ rideId, assignedDriverId }`

This job can be removed (cancelled) via `queue.removeJobById('acceptance-timeout:{rideId}')` when the driver accepts.

---

## Matching Flow (Step-by-Step)

### Step 1 — Ride Creation

1. Passenger calls `POST /rides` or emits `ride:create` socket event
2. `RidesService` validates the request:
   - Passenger has no existing active ride
   - Coordinates are within campus geo-fence bounds
3. PostgreSQL: INSERT into `rides` (status = `REQUESTED`)
4. PostgreSQL: INSERT `ride_events` (event_type = `REQUESTED`)
5. Transition to `SEARCHING`:
   - PostgreSQL: UPDATE `rides.status = 'SEARCHING'`
   - PostgreSQL: INSERT `ride_events` (event_type = `SEARCHING`)
   - Redis: SET `ride:active:{rideId}` Hash (status = SEARCHING)
   - Redis: ACQUIRE `ride:lock:{rideId}` (NX, TTL: 30s)
6. BullMQ: Enqueue job on `ride-matching` queue
7. Socket: Emit `ride:status` to passenger (status = SEARCHING)

---

### Step 2 — Candidate Discovery (Redis GEO)

The matching worker executes a Redis GEO proximity search as the **first and primary** lookup.
PostgreSQL is NOT queried for location data in this step.

```
GEOSEARCH drivers:geo
  FROMLONLAT {pickupLng} {pickupLat}
  BYRADIUS 5 km
  ASC
  COUNT 20
  WITHCOORD
  WITHDIST
```

- Search radius: **5 km** (configurable via `MATCHING_RADIUS_KM` env var)
- Maximum candidates returned: **20**
- Results are sorted by distance ascending

This returns up to 20 driverIds with their distance and coordinates.

**Why Redis GEO and not PostgreSQL PostGIS at this step:**
- Redis GEO queries execute in O(N + log M) where N is returned members
- No network roundtrip overhead for connection checkout (Redis is already connected)
- PostgreSQL PostGIS is used for offline analytics and historical queries only
- Real-time proximity requires sub-millisecond response; Redis GEO provides this

---

### Step 3 — Candidate Filtering

For each driverId returned by the GEO search, filter out:

1. **Driver status check:** Read `driver:status:{driverId}` from Redis
   - Exclude if status ≠ `ONLINE`
   - Exclude if key has expired (driver went offline without explicit event)
2. **Driver lock check:** Check if `driver:lock:{driverId}` exists in Redis
   - Exclude if lock exists (driver is being assigned to another concurrent ride)
3. **Excluded drivers list:** Exclude any driverId in `job.data.excludeDriverIds`
   - This prevents re-assigning a driver who previously rejected or timed out on this ride

After filtering, if **zero candidates remain** → transition ride to `NO_DRIVER_FOUND`.

---

### Step 4 — Candidate Ranking

Each surviving candidate is scored using a weighted formula.

**Ranking Score:**

```
score = (W_dist × distance_score)
      + (W_rating × rating_score)
      + (W_acceptance × acceptance_score)

Where:
  distance_score    = 1 - (distanceKm / MATCHING_RADIUS_KM)       → 0.0 – 1.0 (closer = higher)
  rating_score      = (driver.rating - 1) / 4                      → 0.0 – 1.0 (rating 1–5 normalized)
  acceptance_score  = 1 - (timeouts_24h / max_timeouts_threshold)  → 0.0 – 1.0 (fewer timeouts = higher)

Weights (configurable via environment):
  W_dist        = 0.50  (distance is the primary factor)
  W_rating      = 0.30  (rating quality matters)
  W_acceptance  = 0.20  (penalize drivers who repeatedly time out)
```

**Weight Configuration:**
- `MATCHING_WEIGHT_DISTANCE` (default: 0.50)
- `MATCHING_WEIGHT_RATING` (default: 0.30)
- `MATCHING_WEIGHT_ACCEPTANCE` (default: 0.20)
- Weights must sum to 1.0 — validated at application startup

**Input sources for ranking:**
- `distanceKm`: from Redis GEO search result
- `driver.rating`: from `driver:rating:{driverId}` Redis cache (or PostgreSQL fallback)
- `timeouts_24h`: from `driver:timeout_count:{driverId}` Redis counter

**Output:** Drivers sorted by score descending. Top driver = best candidate.

---

### Step 5 — Driver Assignment (Race Condition Prevention)

This is the most critical step. Two concurrent matching workers could attempt to assign the same driver.
The following two-layer locking mechanism prevents this:

#### Layer 1 — Redis Distributed Lock (Fast Path)

Before writing to PostgreSQL, attempt to acquire the driver lock:

```
SET driver:lock:{driverId} {rideId} NX EX 20
```

- If return value is `nil` → another worker already locked this driver → skip to next ranked candidate
- If return value is `OK` → this worker holds the lock → proceed to PostgreSQL write

This Redis lock serves as the first line of defense and prevents unnecessary DB contention.

#### Layer 2 — PostgreSQL Row-Level Lock (`SELECT FOR UPDATE`)

Even with the Redis lock, the PostgreSQL write must be atomic to handle the case where the Redis lock
is held by a worker that is about to commit a conflicting write (edge case under network delay).

The assignment write uses an explicit transaction with a row lock:

```sql
BEGIN;

-- Lock the ride row to prevent concurrent modifications
SELECT id, status
FROM rides
WHERE id = $1
FOR UPDATE;

-- Verify the ride is still in a state that accepts assignment
-- (it could have been cancelled by the passenger between the Redis lock and now)
-- If status is not SEARCHING → ROLLBACK and abort

-- Insert the assignment
INSERT INTO ride_assignments (ride_id, driver_id, assigned_at)
VALUES ($1, $2, NOW());

-- Update ride status
UPDATE rides
SET status = 'ASSIGNED', updated_at = NOW()
WHERE id = $1;

-- Insert ride event
INSERT INTO ride_events (ride_id, event_type, payload, created_at)
VALUES ($1, 'ASSIGNED', '{"driverId": "..."}', NOW());

COMMIT;
```

**Why `SELECT FOR UPDATE` (not `SELECT FOR UPDATE SKIP LOCKED`):**

`SELECT FOR UPDATE` (without SKIP LOCKED) is used here because:
- We need to read and verify the ride status before committing the assignment
- We want the transaction to wait briefly if another transaction has the row locked (not skip it)
- The ride row is locked for a very short time (< 50ms), so wait-and-retry is acceptable
- SKIP LOCKED is used in queue-consumer patterns where we want to skip already-locked jobs — not applicable here

**Where `SELECT FOR UPDATE SKIP LOCKED` IS used:**

`SKIP LOCKED` is used in the **acceptance deduplication check** — when a driver sends `ride:accept`
and there may be two near-simultaneous accept requests from different HTTP/socket connections:

```sql
BEGIN;

-- Try to lock the ride_assignments row, skip if already locked by another transaction
SELECT id, accepted_at
FROM ride_assignments
WHERE ride_id = $1
  AND driver_id = $2
  AND accepted_at IS NULL
FOR UPDATE SKIP LOCKED;

-- If no row returned → already accepted by another connection → ROLLBACK (return ALREADY_ACCEPTED)
-- If row returned → this transaction wins

UPDATE ride_assignments
SET accepted_at = NOW()
WHERE ride_id = $1 AND driver_id = $2;

UPDATE rides
SET status = 'ACCEPTED', updated_at = NOW()
WHERE id = $1;

COMMIT;
```

`SKIP LOCKED` here means: if another concurrent transaction already has the lock on this
`ride_assignments` row (i.e., another accept request is mid-commit), skip rather than wait —
and return "already accepted" to the latecomer immediately without blocking.

---

### Step 6 — Notification

After assignment is committed to PostgreSQL:

1. Redis: UPDATE `ride:active:{rideId}` Hash (status = ASSIGNED, driverId)
2. Redis: SET `ride:acceptance_deadline:{rideId}` (TTL: 15s)
3. Socket: Emit `driver:assigned_ride` to room `driver:{driverId}`
4. Socket: Emit `ride:assigned` to room `passenger:{passengerId}`
5. BullMQ: Enqueue delayed `acceptance-timeout` job (delay: 15,000ms)

---

### Step 7 — Acceptance Window

The driver has **15 seconds** to respond with `ride:accept` or `ride:reject`.

**If driver accepts:**
1. `SKIP LOCKED` transaction executes (Step 5 above)
2. Redis: DEL `ride:acceptance_deadline:{rideId}`
3. BullMQ: Remove `acceptance-timeout:{rideId}` job
4. Redis: DEL `driver:lock:{driverId}`
5. Socket: Emit `ride:accepted` to passenger
6. State transitions to `ACCEPTED`

**If driver rejects:**
1. Ride state stays `ASSIGNED` momentarily
2. Redis: DEL `driver:lock:{driverId}`
3. Re-enqueue matching job with this driver added to `excludeDriverIds`
4. Move to the next-ranked candidate

**If no response (timeout fires):**
1. BullMQ `acceptance-timeout` job executes
2. Checks: Does `ride:acceptance_deadline:{rideId}` still exist?
   - If NO (driver accepted) → job exits with no-op
   - If YES → proceed with TIMED_OUT transition
3. PostgreSQL: UPDATE rides.status = 'TIMED_OUT'
4. Redis: DEL `driver:lock:{driverId}`
5. Redis: SET `driver:status:{driverId}` = 'ONLINE'
6. Redis: INCR `driver:timeout_count:{driverId}`
7. Socket: Emit `ride:timed_out` to passenger
8. Optionally re-enqueue matching job (if `MATCHING_MAX_RETRY_COUNT` > 0)

---

## NO_DRIVER_FOUND Flow

Triggered when the GEO search returns zero candidates after filtering.

1. PostgreSQL: UPDATE rides.status = 'NO_DRIVER_FOUND'
2. Redis: DEL `ride:active:{rideId}`
3. Redis: DEL `ride:lock:{rideId}`
4. Socket: Emit `ride:no_driver_found` to passenger
5. BullMQ job completes — no retry (terminal state)

---

## Retry Strategy

| Failure Scenario | Retry Behavior |
|---|---|
| BullMQ worker process crash | BullMQ automatically re-queues the job; max 3 attempts |
| Redis GEO timeout | Worker retries the Redis command up to 3 times with 100ms backoff |
| PostgreSQL transaction conflict | Transaction rolled back; worker retries from Step 2 (re-query candidates) |
| Redis lock acquisition failure | Skip this driver; try next candidate |
| All candidates exhausted after retries | Transition to `NO_DRIVER_FOUND` |
| Acceptance timeout job fires but ride was already accepted | Job detects no `ride:acceptance_deadline:{rideId}` key → no-op exit |

**BullMQ job retry configuration:**
```
attempts: 3
backoff:
  type: exponential
  delay: 1000   // 1s → 2s → 4s
```

**Dead letter queue:**
Jobs that fail all 3 attempts are moved to a `ride-matching-failed` queue for manual inspection.
An alert is sent via the monitoring system (Sentry) on every dead letter.

---

## Matching Performance Targets

| Operation | Target Latency |
|---|---|
| Redis GEO search (20 results, 5km radius) | < 5ms |
| Candidate filtering (20 drivers, Redis reads) | < 10ms |
| Candidate ranking (CPU, no I/O) | < 2ms |
| PostgreSQL assignment transaction | < 30ms |
| Total matching time (Steps 2–6) | < 50ms |
| End-to-end (ride creation → driver notification) | < 500ms |
| Total time-to-assignment (including acceptance) | < 3,000ms (engineering rule target) |

---

## Configuration Reference

All matching parameters are configurable via environment variables and validated at startup.

| Variable | Default | Description |
|---|---|---|
| `MATCHING_RADIUS_KM` | `5` | Search radius for nearby drivers |
| `MATCHING_MAX_CANDIDATES` | `20` | Max drivers to retrieve from GEO search |
| `MATCHING_TOP_N` | `3` | Number of top-ranked drivers notified simultaneously |
| `MATCHING_ACCEPTANCE_WINDOW_MS` | `15000` | Driver acceptance window in milliseconds |
| `MATCHING_MAX_RETRY_COUNT` | `0` | Max re-match attempts (0 = disabled) |
| `MATCHING_WEIGHT_DISTANCE` | `0.50` | Distance factor weight |
| `MATCHING_WEIGHT_RATING` | `0.30` | Rating factor weight |
| `MATCHING_WEIGHT_ACCEPTANCE` | `0.20` | Acceptance rate factor weight |

---

## Future Improvements

### Demand-Aware Matching
- Factor in predicted demand in the driver's current zone
- Adjust `MATCHING_RADIUS_KM` dynamically based on supply/demand ratio
- Prefer assigning drivers closer to a high-demand zone to balance fleet distribution

### Zone Balancing
- Track per-zone driver density in Redis (sorted set keyed by zone)
- After a driver completes a ride, suggest nearby high-demand zones via push notification

### Driver Load Balancing
- Track rides completed per driver per hour
- Reduce score multiplier for drivers who have completed many recent rides
- Prevents same high-rated drivers from receiving all rides

### Machine Learning Scoring
- Replace the linear weighted score with a trained ranking model
- Features: time of day, weather, campus event schedule, historical acceptance rates
- Model inference can run as a gRPC sidecar or embedded ONNX model