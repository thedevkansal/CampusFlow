# Ride State Machine

## Overview

This document is the authoritative specification for the CampusFlow ride lifecycle.
Every valid state, every valid transition, the actor responsible for each transition,
and all side effects (database writes, Redis updates, socket events, BullMQ jobs)
are defined here.

No state transition may be implemented that does not appear in this document.
Any proposed transition not listed here requires an architecture review before implementation.

---

## States

### Active States

| State | Description |
|---|---|
| `REQUESTED` | Passenger has submitted a ride request. Ride record exists in the database. Matching has not yet begun. |
| `SEARCHING` | Matching engine has begun candidate selection. Nearby drivers are being evaluated. |
| `ASSIGNED` | Matching engine has selected a driver. The driver has been notified and the acceptance window is open. |
| `ACCEPTED` | Driver has explicitly accepted the ride. Driver is en route to pickup location. |
| `ARRIVING` | Driver has indicated they are at or near the pickup location. |
| `IN_PROGRESS` | Passenger has been picked up. The ride is active. |

### Terminal States

Once a ride enters a terminal state it cannot transition to any other state.

| State | Description |
|---|---|
| `COMPLETED` | Ride finished successfully. Passenger was dropped off at destination. |
| `NO_DRIVER_FOUND` | Matching engine exhausted all candidates and found no available driver. |
| `TIMED_OUT` | Assigned driver did not accept within the acceptance window (15 seconds). |
| `PASSENGER_CANCELLED` | Passenger explicitly cancelled the ride before it reached `IN_PROGRESS`. |
| `DRIVER_CANCELLED` | Assigned driver explicitly cancelled the ride after accepting. |
| `DISPUTED` | Admin-escalated state for rides with contested completion or active complaints. |

---

## Transition Graph

```
                            ┌─────────────────────────────────────────────────┐
                            │                                                 │
                       REQUESTED                                              │
                            │                                                 │
                    [System / BullMQ]                                         │
                            │                                                 │
                            ▼                                                 │
                       SEARCHING ──────────────────► NO_DRIVER_FOUND (terminal)
                            │                                                 │
                    [Matching Engine]                                         │
                            │                                                 │
                            ▼                                                 │
                       ASSIGNED ───────────────────► TIMED_OUT (terminal)    │
                            │                                                 │
              ┌─────────────┤                                                 │
              │             │                                                 │
   [Passenger CANCEL]  [Driver ACCEPT]                                        │
              │             │                                                 │
              ▼             ▼                                                 │
  PASSENGER_CANCELLED  ACCEPTED                                               │
  (terminal)               │                                                  │
              │             ├─────────────────────────────────────────────────┘
              │        [Driver ARRIVE]
              │             │
              │             ▼
              │        ARRIVING
              │             │
              │        [Driver START]
              │             │
              │             ▼
              │        IN_PROGRESS
              │             │
              │    ┌────────┴──────────┐
              │    │                   │
              │ [Driver COMPLETE]  [Admin DISPUTE]
              │    │                   │
              │    ▼                   ▼
              │  COMPLETED          DISPUTED
              │  (terminal)         (terminal)
              │
              └── [Driver CANCEL after ACCEPTED/ARRIVING]
                         │
                         ▼
                  DRIVER_CANCELLED
                  (terminal)
```

---

## Valid Transitions

The table below defines every permitted state transition. Any transition not listed is **forbidden** and must return an error.

| From State | To State | Actor | Trigger |
|---|---|---|---|
| `REQUESTED` | `SEARCHING` | System | Matching engine job enqueued |
| `REQUESTED` | `PASSENGER_CANCELLED` | Passenger | `POST /rides/:id/cancel` or socket `ride:cancel` |
| `SEARCHING` | `ASSIGNED` | Matching Engine | Driver candidate selected |
| `SEARCHING` | `NO_DRIVER_FOUND` | Matching Engine | No candidates found after exhaustion |
| `ASSIGNED` | `ACCEPTED` | Driver | Socket `ride:accept` |
| `ASSIGNED` | `TIMED_OUT` | System (BullMQ) | Acceptance TTL job fires |
| `ASSIGNED` | `PASSENGER_CANCELLED` | Passenger | `POST /rides/:id/cancel` |
| `ACCEPTED` | `ARRIVING` | Driver | Socket `driver:arrive` |
| `ACCEPTED` | `DRIVER_CANCELLED` | Driver | Socket `ride:cancel` (driver-initiated) |
| `ACCEPTED` | `PASSENGER_CANCELLED` | Passenger | `POST /rides/:id/cancel` |
| `ARRIVING` | `IN_PROGRESS` | Driver | Socket `ride:start` or `POST /rides/:id/start` |
| `ARRIVING` | `DRIVER_CANCELLED` | Driver | Socket `ride:cancel` (driver-initiated) |
| `IN_PROGRESS` | `COMPLETED` | Driver | Socket `ride:complete` or `POST /rides/:id/complete` |
| `IN_PROGRESS` | `DISPUTED` | Admin | `PATCH /admin/rides/:id/dispute` |
| `COMPLETED` | `DISPUTED` | Admin | `PATCH /admin/rides/:id/dispute` |

---

## Side Effects Per Transition

Each transition produces a deterministic set of side effects. All side effects must be executed atomically where possible (DB write + Redis update in the same logical operation before socket emission).

---

### REQUESTED → SEARCHING

**Actor:** System (triggered immediately after ride creation)

**Database Writes:**
- Update `rides.status = 'SEARCHING'`
- Insert `ride_events` record: `{ event_type: 'SEARCHING', ride_id, created_at }`

**Redis Updates:**
- Set `ride:active:{rideId}` Hash with current status and passenger info (TTL: 24h)
- Acquire `ride:lock:{rideId}` (NX, TTL: 30s) — matching engine holds this lock

**BullMQ Jobs:**
- Enqueue job on `ride-matching` queue with payload `{ rideId, pickupLat, pickupLng, requestedAt }`
- Job priority: CRITICAL

**Socket Events:**
- Emit `ride:status` to passenger's socket (`/passenger` namespace, room `passenger:{passengerId}`)
  - Payload: `{ rideId, status: 'SEARCHING' }`

---

### SEARCHING → ASSIGNED

**Actor:** Matching Engine (BullMQ worker)

**Database Writes:**
- Update `rides.status = 'ASSIGNED'`
- Insert `ride_assignments` record: `{ ride_id, driver_id, assigned_at: now() }`
- Insert `ride_events` record: `{ event_type: 'ASSIGNED', payload: { driverId } }`

**Redis Updates:**
- Update `ride:active:{rideId}` Hash — set `status = 'ASSIGNED'`, `driverId`
- Set `driver:status:{driverId}` = `'BUSY'` (sliding TTL: 60s)
- Acquire `driver:lock:{driverId}` (NX, TTL: 20s) — prevents double-assignment during acceptance window
- Enqueue acceptance TTL: Set `ride:acceptance_deadline:{rideId}` = timestamp (TTL: 15s)

**BullMQ Jobs:**
- Enqueue job on `notifications` queue: notify driver of new ride assignment
- Enqueue delayed job on `ride-matching` queue: acceptance timeout job (delay: 15s)

**Socket Events:**
- Emit `driver:assigned_ride` to driver (`/driver` namespace, room `driver:{driverId}`)
  - Payload: `{ rideId, passenger: { name, rating }, pickup: { lat, lng, address }, destination: { lat, lng, address }, estimatedFare }`
- Emit `ride:status` to passenger (`/passenger` namespace)
  - Payload: `{ rideId, status: 'ASSIGNED', driver: { name, vehicle, rating, currentLat, currentLng } }`

---

### SEARCHING → NO_DRIVER_FOUND

**Actor:** Matching Engine (BullMQ worker)

**Database Writes:**
- Update `rides.status = 'NO_DRIVER_FOUND'`
- Insert `ride_events` record: `{ event_type: 'NO_DRIVER_FOUND' }`

**Redis Updates:**
- Delete `ride:active:{rideId}`
- Release `ride:lock:{rideId}`

**BullMQ Jobs:**
- Enqueue job on `notifications` queue: notify passenger no driver found

**Socket Events:**
- Emit `ride:no_driver_found` to passenger (`/passenger` namespace)
  - Payload: `{ rideId, message: 'No drivers available. Please try again.' }`

---

### ASSIGNED → ACCEPTED

**Actor:** Driver

**Database Writes:**
- Update `rides.status = 'ACCEPTED'`
- Update `ride_assignments.accepted_at = now()`
- Insert `ride_events` record: `{ event_type: 'ACCEPTED' }`
- **This write uses `SELECT FOR UPDATE` on the `ride_assignments` row to prevent race conditions.**

**Redis Updates:**
- Update `ride:active:{rideId}` Hash — set `status = 'ACCEPTED'`
- Delete `ride:acceptance_deadline:{rideId}` (cancels the timeout reference)
- Release `driver:lock:{driverId}` — lock is no longer needed (driver is committed)

**BullMQ Jobs:**
- Cancel the pending acceptance-timeout job for this `rideId` (via BullMQ job ID lookup)
- Enqueue job on `notifications` queue: notify passenger driver is en route

**Socket Events:**
- Emit `ride:accepted` to passenger (`/passenger` namespace)
  - Payload: `{ rideId, driver: { name, vehicle, rating, currentLat, currentLng, eta } }`
- Emit acknowledgement back to driver (`/driver` namespace): `{ rideId, status: 'ACCEPTED', confirmed: true }`

---

### ASSIGNED → TIMED_OUT

**Actor:** System (BullMQ delayed job)

**Database Writes:**
- Update `rides.status = 'TIMED_OUT'`
- Insert `ride_events` record: `{ event_type: 'TIMED_OUT', payload: { driverWhoFailed: driverId } }`

**Redis Updates:**
- Delete `ride:active:{rideId}`
- Release `driver:lock:{driverId}` — driver is freed
- Set `driver:status:{driverId}` = `'ONLINE'` (reset availability)

**BullMQ Jobs:**
- Optionally re-enqueue a new matching job if retry policy allows (`maxRetries` from config)
- Increment driver's `driver:timeout_count:{driverId}` counter (for acceptance rate tracking)

**Socket Events:**
- Emit `ride:timed_out` to passenger (`/passenger` namespace)
  - Payload: `{ rideId, message: 'Driver did not respond. Searching again...' }`
- Emit notification to driver informing them the opportunity expired

---

### ASSIGNED → PASSENGER_CANCELLED

**Actor:** Passenger

**Database Writes:**
- Update `rides.status = 'PASSENGER_CANCELLED'`
- Insert `ride_events` record: `{ event_type: 'PASSENGER_CANCELLED' }`
- Insert `cancellation_reasons` record: `{ ride_id, cancelled_by: 'PASSENGER', reason_code, created_at }`

**Redis Updates:**
- Delete `ride:active:{rideId}`
- Release `ride:lock:{rideId}`
- Release `driver:lock:{driverId}`
- Set `driver:status:{driverId}` = `'ONLINE'`

**BullMQ Jobs:**
- Cancel any pending acceptance-timeout job for this `rideId`
- Enqueue job on `notifications` queue: notify driver ride was cancelled

**Socket Events:**
- Emit `ride:cancelled` to driver (`/driver` namespace): `{ rideId, cancelledBy: 'PASSENGER' }`
- Emit `ride:cancelled` to passenger (`/passenger` namespace): `{ rideId, status: 'PASSENGER_CANCELLED' }`

---

### ACCEPTED → ARRIVING

**Actor:** Driver

**Database Writes:**
- Update `rides.status = 'ARRIVING'`
- Insert `ride_events` record: `{ event_type: 'ARRIVING' }`

**Redis Updates:**
- Update `ride:active:{rideId}` Hash — set `status = 'ARRIVING'`

**BullMQ Jobs:**
- None

**Socket Events:**
- Emit `ride:driver_arriving` to passenger (`/passenger` namespace)
  - Payload: `{ rideId, driver: { name, vehicle, currentLat, currentLng }, eta: seconds }`

---

### ACCEPTED / ARRIVING → DRIVER_CANCELLED

**Actor:** Driver

**Database Writes:**
- Update `rides.status = 'DRIVER_CANCELLED'`
- Insert `ride_events` record: `{ event_type: 'DRIVER_CANCELLED' }`
- Insert `cancellation_reasons` record: `{ ride_id, cancelled_by: 'DRIVER', reason_code, created_at }`

**Redis Updates:**
- Delete `ride:active:{rideId}`
- Set `driver:status:{driverId}` = `'ONLINE'`
- Increment `driver:cancellation_count:{driverId}` (for acceptance rate tracking)

**BullMQ Jobs:**
- Enqueue job on `notifications` queue: notify passenger driver cancelled
- Optionally re-enqueue matching job for the original ride (policy decision: configurable)

**Socket Events:**
- Emit `ride:cancelled` to passenger (`/passenger` namespace): `{ rideId, cancelledBy: 'DRIVER', message: 'Driver cancelled. Searching for a new driver.' }`

---

### ARRIVING → IN_PROGRESS

**Actor:** Driver

**Database Writes:**
- Update `rides.status = 'IN_PROGRESS'`
- Insert `ride_events` record: `{ event_type: 'STARTED' }`

**Redis Updates:**
- Update `ride:active:{rideId}` Hash — set `status = 'IN_PROGRESS'`

**BullMQ Jobs:**
- None

**Socket Events:**
- Emit `ride:started` to passenger (`/passenger` namespace): `{ rideId, status: 'IN_PROGRESS' }`

---

### IN_PROGRESS → COMPLETED

**Actor:** Driver

**Database Writes:**
- Update `rides.status = 'COMPLETED'`
- Update `rides.completed_at = now()`
- Insert `ride_events` record: `{ event_type: 'COMPLETED' }`
- Insert `ride_fare` record: `{ ride_id, amount, currency, calculated_at }`
- Update `driver_earnings` ledger record

**Redis Updates:**
- Delete `ride:active:{rideId}`
- Set `driver:status:{driverId}` = `'ONLINE'`
- Remove driver from any active ride references

**BullMQ Jobs:**
- Enqueue job on `analytics-ingestion` queue: record completed ride analytics event
- Enqueue job on `notifications` queue: prompt passenger for rating

**Socket Events:**
- Emit `ride:completed` to passenger (`/passenger` namespace): `{ rideId, fare, destination, prompt: 'Please rate your driver' }`
- Emit `ride:completed` to driver (`/driver` namespace): `{ rideId, earnings }`

---

### IN_PROGRESS / COMPLETED → DISPUTED

**Actor:** Admin

**Database Writes:**
- Update `rides.status = 'DISPUTED'`
- Insert `ride_events` record: `{ event_type: 'DISPUTED', payload: { adminId, reason } }`
- Insert `admin_actions` record: `{ admin_id, action: 'DISPUTE_RIDE', target_id: rideId }`

**Redis Updates:**
- None (ride is no longer active)

**BullMQ Jobs:**
- Enqueue job on `notifications` queue: notify both passenger and driver of dispute escalation

**Socket Events:**
- Emit `notification:new` to passenger and driver: `{ type: 'RIDE_DISPUTED', rideId }`

---

## Forbidden Transitions

The following transitions are explicitly prohibited and must return HTTP 422 or socket error:

- `COMPLETED` → any active state
- `NO_DRIVER_FOUND` → any state
- `TIMED_OUT` → any state
- `PASSENGER_CANCELLED` → any state
- `DRIVER_CANCELLED` → any state
- `DISPUTED` → any state except by Admin escalation
- `IN_PROGRESS` → `CANCELLED` (use `DISPUTED` instead)
- `REQUESTED` → `ASSIGNED` (must pass through `SEARCHING`)
- `SEARCHING` → `ACCEPTED` (must pass through `ASSIGNED`)

---

## Cancellation Policy Summary

| State at Cancellation | Who Cancels | Resulting State | Re-match? |
|---|---|---|---|
| `REQUESTED` | Passenger | `PASSENGER_CANCELLED` | No |
| `SEARCHING` | Passenger | `PASSENGER_CANCELLED` | No |
| `ASSIGNED` | Passenger | `PASSENGER_CANCELLED` | No |
| `ASSIGNED` | System (timeout) | `TIMED_OUT` | Configurable |
| `ACCEPTED` | Passenger | `PASSENGER_CANCELLED` | No |
| `ACCEPTED` | Driver | `DRIVER_CANCELLED` | Configurable |
| `ARRIVING` | Driver | `DRIVER_CANCELLED` | Configurable |
| `IN_PROGRESS` | Neither | `DISPUTED` (Admin only) | No |

---

## Acceptance Window

- Duration: **15 seconds** from the moment `driver:assigned_ride` is emitted
- Mechanism: BullMQ delayed job (`ride-matching` queue, delay = 15000ms)
- On expiry: Transition to `TIMED_OUT`
- Job ID format: `acceptance-timeout:{rideId}` (used for cancellation if driver accepts in time)

---

## State Persistence Contract

- **PostgreSQL** is the source of truth for all ride states
- **Redis** (`ride:active:{rideId}`) caches the current state for low-latency reads
- **Redis must never be the primary state store** — it is a cache only
- On cache miss, the system reads from PostgreSQL and re-populates the cache
- All `ride_events` entries are immutable; states are only updated on the `rides` table

---

## Re-matching Policy

Re-matching after a failed assignment is **disabled by default** to prevent infinite loops.

Configuration key: `MATCHING_MAX_RETRY_COUNT` (default: 0)

If enabled, a re-match creates a **new BullMQ job** for the original `rideId` and resets the state to `SEARCHING`. The `ride_events` table records a `REMATCHED` event type for traceability.
