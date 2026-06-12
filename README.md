<div align="center">

<img src="https://img.shields.io/badge/CampusFlow-Ride%20Sharing-4F46E5?style=for-the-badge&logo=car&logoColor=white" alt="CampusFlow" height="40"/>

# CampusFlow

### Campus ride-sharing infrastructure — built production-grade from day one.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?style=flat-square&logo=nestjs)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)](https://typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-Upstash-DC382D?style=flat-square&logo=redis)](https://upstash.com)
[![BullMQ](https://img.shields.io/badge/BullMQ-Queue-FF6B6B?style=flat-square)](https://docs.bullmq.io)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?style=flat-square&logo=socket.io)](https://socket.io)
[![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED?style=flat-square&logo=docker)](https://docker.com)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma)](https://prisma.io)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

**[Live Demo](https://campusflow-six-chi.vercel.app)** · **[API](https://campusflow-y2g2.onrender.com/api/v1)** · **[Health](https://campusflow-y2g2.onrender.com/health)**

</div>

---

## Table of Contents

- [Overview](#overview)
- [Application Walkthrough](#application-walkthrough)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Ride Lifecycle State Machine](#ride-lifecycle-state-machine)
- [Authentication Flow](#authentication-flow)
- [Matching Engine](#matching-engine)
- [Database Design](#database-design)
- [API Reference](#api-reference)
- [Real-Time Protocol](#real-time-protocol)
- [Feature Matrix](#feature-matrix)
- [Project Structure](#project-structure)
- [Security Model](#security-model)
- [Deployment](#deployment)
- [Known Issues](#known-issues)
- [Engineering Lessons](#engineering-lessons)
- [Roadmap](#roadmap)
- [Resume Impact](#resume-impact)

---

## Overview

CampusFlow is a **full-stack, event-driven ride-sharing platform** built specifically for campus environments. It is not a tutorial project — it implements production-grade patterns across every layer of the stack:

- **Distributed state management** via Redis + PostgreSQL dual-write
- **Event-driven architecture** via Socket.IO namespaces with JWT auth middleware
- **Async job processing** via BullMQ with delayed jobs, repeatable workers, and retry logic
- **Strict state machine enforcement** for the ride lifecycle (11 states, 14 transitions)
- **RBAC** at the service layer, not just the controller
- **Repository pattern** with zero direct Prisma access outside the data layer
- **Geospatial driver matching** via Redis GEO commands with weighted ranking

> Built across 7 engineering phases over a single sprint — from infrastructure bootstrapping to live tracking, pricing engine, ratings, and a complete React frontend.

---

## Application Walkthrough

### Landing Page
![Landing Page](./assets/landing-page.png)

> Clean, conversion-focused landing with hero, feature breakdown, and dual CTA for passengers and drivers.

---

### Passenger Dashboard — Active Ride with Map
![Passenger Dashboard](./assets/passenger-dashboard.png)

> Real-time ride tracking with Leaflet/OpenStreetMap. Route polyline, pickup/destination markers, fare estimate, and live status updates via Socket.IO.

---

### Driver Dashboard — Ride Assignment
![Driver Dashboard](./assets/driver-dashboard.png)

> Driver sees new ride assignment in real-time with passenger info, pickup/destination, estimated fare. Accept/Decline with one click.

---

### Notifications
![Notifications](./assets/notifications.png)

> Persistent in-app notifications for every ride lifecycle event — delivered real-time via Socket.IO and stored in PostgreSQL.

---

### Profile Page
![Profile](./assets/profile.png)

> User profile with real ratings, total rides, vehicle info for drivers, and inline vehicle editing via `PATCH /drivers/profile`.

---

## System Architecture

```mermaid
graph TB
    subgraph Client["Client Layer"]
        FE["Next.js 16<br/>App Router + TailwindCSS"]
        SC["Socket.IO Client<br/>/passenger · /driver"]
    end

    subgraph Edge["Edge / CDN"]
        VCL["Vercel<br/>Global CDN"]
    end

    subgraph API["API Layer — NestJS"]
        GW["REST Controllers<br/>/api/v1/*"]
        WS["Socket.IO Gateway<br/>JWT Middleware"]
        AUTH["Auth Module<br/>JWT + bcrypt"]
        RIDES["Rides Module<br/>State Machine"]
        DRIVERS["Drivers Module<br/>Geo + Status"]
        NOTIF["Notifications Module"]
        RATINGS["Ratings Module"]
        PRICING["Fare Engine<br/>Haversine"]
        MATCH["Matching Engine<br/>Redis GEO"]
    end

    subgraph Queue["Queue Layer — BullMQ"]
        MQ["ride-matching"]
        LP["location-persistence"]
        NQ["notifications"]
    end

    subgraph Data["Data Layer"]
        PG[("PostgreSQL 16<br/>Source of Truth")]
        RD[("Redis — Upstash<br/>Cache + Pub/Sub + GEO")]
    end

    subgraph Infra["Infrastructure"]
        RND["Render<br/>Backend Host"]
        UPS["Upstash<br/>Managed Redis"]
    end

    FE -->|HTTPS REST| VCL
    VCL -->|Proxy| GW
    SC <-->|WSS| WS
    GW --> AUTH & RIDES & DRIVERS & NOTIF & RATINGS & PRICING
    RIDES --> MATCH
    MATCH -->|GEO search| RD
    RIDES & DRIVERS & AUTH --> PG
    RIDES & DRIVERS --> RD
    MATCH --> MQ
    DRIVERS --> LP
    NOTIF --> NQ
    MQ & LP & NQ -->|Workers| PG
    MQ & LP -->|Read/Write| RD
    RND --> GW & WS
    UPS --> RD
```

---

### Data Flow — Request to Real-Time Event

```mermaid
sequenceDiagram
    participant P as Passenger App
    participant API as NestJS API
    participant DB as PostgreSQL
    participant RD as Redis
    participant MQ as BullMQ
    participant D as Driver App

    P->>API: POST /rides {pickup, dest}
    API->>DB: INSERT ride (REQUESTED)
    API->>DB: UPDATE ride (SEARCHING)
    API->>RD: SET ride:active:{id}
    API->>MQ: ENQUEUE match-ride job
    API-->>P: 201 {rideId, status: SEARCHING}

    Note over MQ: Matching Worker picks up job
    MQ->>RD: GEODIST drivers within 5km
    RD-->>MQ: [driverId1, driverId2]
    MQ->>DB: INSERT ride_assignment (ASSIGNED)
    MQ->>RD: SET driver:active-ride:{driverId}
    MQ->>MQ: SCHEDULE acceptance-timeout (15s)

    MQ-->>D: Socket emit ride_assigned
    MQ-->>P: Socket emit ride_assigned

    D->>API: POST /rides/:id/accept
    API->>DB: UPDATE ride (ACCEPTED)
    API-->>D: Socket emit ride_accepted
    API-->>P: Socket emit ride_accepted
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 16 (App Router) | SSR/SSG, file-based routing |
| **UI** | TailwindCSS + Base UI | Utility styling, accessible components |
| **State** | TanStack React Query | Server state, caching, background sync |
| **Maps** | Leaflet + OpenStreetMap | Driver tracking, route visualization |
| **Realtime (FE)** | Socket.IO Client | Ride events, location streaming |
| **Backend** | NestJS 10 | Modular DI framework, TypeScript-native |
| **ORM** | Prisma 5 | Type-safe DB client, migrations |
| **Database** | PostgreSQL 16 | Relational source of truth |
| **Cache / GEO** | Redis (Upstash) | Driver state, GEO search, pub/sub, rate limiting |
| **Queue** | BullMQ | Matching jobs, location persistence, cleanup |
| **Realtime (BE)** | Socket.IO + Redis Adapter | Multi-instance pub/sub, namespaced gateways |
| **Auth** | JWT (RS256) + bcrypt | Stateless auth, password hashing |
| **Containerization** | Docker + Compose | Local dev parity |
| **Backend Host** | Render | Auto-deploy from Git |
| **Frontend Host** | Vercel | Edge CDN, preview deployments |
| **Redis Host** | Upstash | Serverless Redis with REST fallback |

---

## Ride Lifecycle State Machine

> 11 states · 14 transitions · enforced at the service layer with `UnprocessableEntityException` on invalid transitions.

```mermaid
stateDiagram-v2
    [*] --> REQUESTED : POST /rides

    REQUESTED --> SEARCHING : Matching engine enqueued
    SEARCHING --> ASSIGNED : Driver found via GEO search
    SEARCHING --> NO_DRIVER_FOUND : No drivers in radius

    ASSIGNED --> ACCEPTED : Driver accepts within window
    ASSIGNED --> TIMED_OUT : Acceptance window expires (15s)
    ASSIGNED --> DRIVER_CANCELLED : Driver declines
    ASSIGNED --> PASSENGER_CANCELLED : Passenger cancels

    ACCEPTED --> ARRIVING : Driver marks arrived
    ACCEPTED --> DRIVER_CANCELLED : Driver cancels
    ACCEPTED --> PASSENGER_CANCELLED : Passenger cancels

    ARRIVING --> IN_PROGRESS : Driver starts ride
    ARRIVING --> DRIVER_CANCELLED : Driver cancels

    IN_PROGRESS --> COMPLETED : Driver completes ride

    COMPLETED --> [*]
    TIMED_OUT --> [*]
    NO_DRIVER_FOUND --> [*]
    PASSENGER_CANCELLED --> [*]
    DRIVER_CANCELLED --> [*]
```

### Transition Rules

| From | To | Trigger | Side Effects |
|------|----|---------|-------------|
| `REQUESTED` | `SEARCHING` | Ride created | BullMQ job enqueued |
| `SEARCHING` | `ASSIGNED` | Driver matched | Redis GEO lock, 15s BullMQ timeout |
| `ASSIGNED` | `ACCEPTED` | `POST /accept` | Timeout job cancelled, driver room joined |
| `ASSIGNED` | `TIMED_OUT` | BullMQ delayed job | Driver unlocked, re-queued for matching |
| `ACCEPTED` | `ARRIVING` | `POST /arrive` | `ride_updated` emitted |
| `ARRIVING` | `IN_PROGRESS` | `POST /start` | `ride_updated` emitted |
| `IN_PROGRESS` | `COMPLETED` | `POST /complete` | Fare persisted, driver set ONLINE, Redis cleanup |

---

## Authentication Flow

```mermaid
sequenceDiagram
    actor U as User
    participant FE as Next.js
    participant API as NestJS Auth
    participant JWT as JWT Service
    participant DB as PostgreSQL

    Note over U,DB: Registration
    U->>FE: Fill register form
    FE->>API: POST /auth/register {name,email,password,role}
    API->>DB: SELECT count WHERE email = ?
    DB-->>API: 0 (email free)
    API->>API: bcrypt.hash(password, 12)
    API->>DB: INSERT users
    DB-->>API: user record
    API-->>FE: 201 {userId, email, role}

    Note over U,DB: Login
    U->>FE: Submit credentials
    FE->>API: POST /auth/login {email,password}
    API->>DB: SELECT user WHERE email = ?
    DB-->>API: user + passwordHash
    API->>API: bcrypt.compare(password, hash)
    API->>JWT: sign({sub, email, role, driverId})
    JWT-->>API: accessToken + refreshToken
    API-->>FE: 200 {accessToken, user}
    FE->>FE: localStorage.setItem('token')

    Note over U,DB: Protected Request
    U->>FE: Navigate to /dashboard
    FE->>API: GET /rides/active [Bearer token]
    API->>JWT: verify(token)
    JWT-->>API: {sub, role, driverId}
    API->>DB: SELECT ride WHERE passengerId = sub
    DB-->>API: active ride
    API-->>FE: 200 {ride}
```

---

## Matching Engine

```mermaid
sequenceDiagram
    participant PS as Passenger
    participant API as Rides Service
    participant MQ as BullMQ Worker
    participant RD as Redis
    participant DB as PostgreSQL
    participant DR as Driver

    PS->>API: POST /rides (create)
    API->>DB: INSERT ride REQUESTED → SEARCHING
    API->>RD: SET ride:active:{id} {passengerId, status}
    API->>MQ: ADD job match-ride {rideId, lat, lng, radius: 5km}

    Note over MQ: Worker picks up within ms
    MQ->>RD: GEODIST drivers:geo {lat,lng} 5km ASC
    RD-->>MQ: [driverId_A, driverId_B, driverId_C]

    loop For each candidate (priority order)
        MQ->>RD: GET driver:status:{driverId}
        RD-->>MQ: "ONLINE"
        MQ->>RD: SET driver:lock:{driverId} NX EX 20
        Note over MQ: Lock acquired → proceed
        MQ->>DB: INSERT ride_assignment {rideId, driverId}
        MQ->>DB: UPDATE ride SET status = ASSIGNED
        MQ->>RD: SET driver:active-ride:{driverId} {rideId}
        MQ->>MQ: ADD delayed job acceptance-timeout +15s
        MQ-->>DR: Socket emit ride_assigned
        MQ-->>PS: Socket emit ride_assigned
        Note over MQ: Break — driver found
    end

    alt Driver accepts within 15s
        DR->>API: POST /rides/:id/accept
        API->>DB: UPDATE ride ASSIGNED → ACCEPTED
        API->>MQ: REMOVE acceptance-timeout job
        API-->>DR: Socket emit ride_accepted
        API-->>PS: Socket emit ride_accepted
    else Timeout fires
        MQ->>DB: UPDATE ride ASSIGNED → TIMED_OUT
        MQ->>RD: DEL driver:lock, DEL driver:active-ride
        MQ->>DB: UPDATE driver SET status = ONLINE
        MQ->>MQ: ADD job match-ride (retry with next driver)
    end
```

---

## Database Design

```mermaid
erDiagram
    USER {
        uuid id PK
        varchar name
        varchar email UK
        varchar passwordHash
        enum role
        decimal averageRating
        int totalRatings
        timestamp createdAt
    }

    DRIVER {
        uuid id PK
        uuid userId FK
        varchar vehicleNumber
        varchar vehicleModel
        varchar vehicleColor
        decimal rating
        int totalRatings
        enum status
        bool isVerified
    }

    DRIVER_LOCATION {
        uuid driverId PK,FK
        decimal latitude
        decimal longitude
        decimal heading
        decimal speed
        timestamp updatedAt
    }

    RIDE {
        uuid id PK
        uuid passengerId FK
        decimal pickupLat
        decimal pickupLng
        varchar pickupAddress
        decimal destLat
        decimal destLng
        varchar destAddress
        enum status
        decimal estimatedDistanceKm
        decimal estimatedFare
        timestamp requestedAt
        timestamp completedAt
    }

    RIDE_ASSIGNMENT {
        uuid rideId PK,FK
        uuid driverId FK
        timestamp acceptedAt
    }

    RIDE_EVENT {
        uuid id PK
        uuid rideId FK
        enum eventType
        jsonb payload
        timestamp createdAt
    }

    RIDE_FARE {
        uuid id PK
        uuid rideId FK
        decimal amount
        decimal distanceKm
        varchar currency
    }

    RATING {
        uuid id PK
        uuid rideId FK
        uuid reviewerId FK
        uuid revieweeId FK
        int score
        text comment
        timestamp createdAt
    }

    NOTIFICATION {
        uuid id PK
        uuid userId FK
        varchar type
        varchar title
        varchar message
        bool isRead
        jsonb metadata
        timestamp createdAt
    }

    USER ||--o{ RIDE : "requests (passenger)"
    USER ||--o| DRIVER : "has profile"
    DRIVER ||--o| DRIVER_LOCATION : "current location"
    RIDE ||--o| RIDE_ASSIGNMENT : "assigned driver"
    RIDE ||--o{ RIDE_EVENT : "audit trail"
    RIDE ||--o| RIDE_FARE : "fare record"
    RIDE ||--o{ RATING : "reviews"
    USER ||--o{ NOTIFICATION : "receives"
    DRIVER ||--o{ RIDE_ASSIGNMENT : "assigned to"
```

---

## API Reference

### Authentication

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `POST` | `/auth/register` | — | — | Create account |
| `POST` | `/auth/login` | — | — | Get JWT tokens |
| `GET` | `/auth/profile` | JWT | Any | Own profile + stats |

### Rides

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `POST` | `/rides` | JWT | PASSENGER | Create ride request |
| `GET` | `/rides` | JWT | PASSENGER | Ride history |
| `GET` | `/rides/active` | JWT | PASSENGER | Current active ride |
| `GET` | `/rides/driver-active` | JWT | DRIVER | Driver's active ride |
| `GET` | `/rides/:id` | JWT | ANY | Ride detail (role-shaped) |
| `POST` | `/rides/:id/cancel` | JWT | PASSENGER | Cancel ride |
| `POST` | `/rides/:id/accept` | JWT | DRIVER | Accept assigned ride |
| `POST` | `/rides/:id/arrive` | JWT | DRIVER | Mark arrived at pickup |
| `POST` | `/rides/:id/start` | JWT | DRIVER | Start ride |
| `POST` | `/rides/:id/complete` | JWT | DRIVER | Complete ride |
| `POST` | `/rides/:id/cancel-driver` | JWT | DRIVER | Driver cancels |

### Drivers

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `POST` | `/drivers/register` | JWT | DRIVER | Create driver profile |
| `GET` | `/drivers/profile` | JWT | DRIVER | Own profile |
| `PATCH` | `/drivers/profile` | JWT | DRIVER | Update vehicle info |
| `POST` | `/drivers/online` | JWT | DRIVER | Go online |
| `POST` | `/drivers/offline` | JWT | DRIVER | Go offline |
| `PATCH` | `/drivers/location` | JWT | DRIVER | Update GPS (REST, rate limited) |

### Notifications

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `GET` | `/notifications` | JWT | ANY | All notifications (paginated) |
| `GET` | `/notifications/unread` | JWT | ANY | Unread count |
| `PATCH` | `/notifications/:id/read` | JWT | ANY | Mark single read |
| `PATCH` | `/notifications/read-all` | JWT | ANY | Mark all read |

### Ratings

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `POST` | `/ratings` | JWT | ANY | Submit rating (post-COMPLETED) |
| `GET` | `/ratings/ride/:rideId` | JWT | ANY | Ratings for a ride |
| `GET` | `/ratings/received` | JWT | ANY | Ratings received |
| `GET` | `/ratings/given` | JWT | ANY | Ratings given |

> All responses follow the envelope format: `{ success: boolean, data: T, message: string }`

---

## Real-Time Protocol

### Socket Namespaces

| Namespace | Who Connects | Auth Required |
|-----------|-------------|---------------|
| `/passenger` | PASSENGER role | JWT in `auth.token` |
| `/driver` | DRIVER role | JWT in `auth.token` (driverId required) |

### Events (Server → Client)

| Event | Namespace | Payload | Description |
|-------|-----------|---------|-------------|
| `ride_assigned` | Both | `{ rideId, status, driver?, passenger? }` | Ride matched |
| `ride_accepted` | Both | `{ rideId, status }` | Driver accepted |
| `ride_updated` | Both | `{ rideId, status }` | State transition |
| `ride_cancelled` | Both | `{ rideId, status, cancelledBy }` | Cancellation |
| `ride_completed` | Both | `{ rideId, status }` | Ride finished |
| `driver:location_update` | Both | `{ driverId, lat, lng, heading, speed }` | Driver position |
| `notification_created` | Both | `{ id, type, title, message }` | New notification |

### Events (Client → Server)

| Event | Namespace | Payload | Rate Limit |
|-------|-----------|---------|------------|
| `driver:location` | `/driver` | `{ latitude, longitude, heading?, speed? }` | 120/min |
| `session:restore` | Both | `{ lastEventTimestamp }` | — |

---

## Feature Matrix

| Feature | Status | Technology |
|---------|--------|-----------|
| JWT Authentication | ✅ Implemented | NestJS Guards, bcrypt, RS256 |
| Role-Based Access Control | ✅ Implemented | `@Roles()` decorator, service-layer enforcement |
| Ride Request & Lifecycle | ✅ Implemented | State machine, 11 states, 14 transitions |
| Driver Matching Engine | ✅ Implemented | BullMQ + Redis GEO + weighted ranking |
| Acceptance Timeout | ✅ Implemented | BullMQ delayed jobs, automatic retry |
| Real-Time Ride Events | ✅ Implemented | Socket.IO + Redis adapter |
| Driver Location Streaming | ✅ Implemented | Socket.IO, GEO set, rate limiting |
| Location Persistence | ✅ Implemented | BullMQ async pipeline, DB upsert |
| Stale Driver Cleanup | ✅ Implemented | Repeatable BullMQ job, TTL-based GEO removal |
| Fare Calculation | ✅ Implemented | Haversine formula, configurable rates |
| In-App Notifications | ✅ Implemented | PostgreSQL + Socket.IO delivery |
| Ratings & Reviews | ✅ Implemented | Post-COMPLETED, duplicate prevention |
| Session Recovery | ✅ Implemented | `session:restore` event, missed event replay |
| Active Ride Guard | ✅ Implemented | Prevents duplicate ride requests |
| Redis Cache | ✅ Implemented | Driver status, active rides, locks |
| Docker Deployment | ✅ Implemented | Compose, multi-service |
| Health Endpoint | ✅ Implemented | `/health` |
| Ride History | ✅ Implemented | Paginated ride list |
| Profile Stats | ✅ Implemented | Rating, total rides, ratings received |
| Vehicle Profile Edit | ✅ Implemented | `PATCH /drivers/profile` |
| Push Notifications | 🔄 Planned | Phase 4 |
| Surge Pricing | 🔄 Planned | Phase 4 |
| Multi-Campus | 🔄 Planned | Phase 5 |
| Admin Dashboard | 🔄 Planned | Phase 5 |

---

## Project Structure

```
campusflow/
├── frontend/                          # Next.js 16 App Router
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx               # Landing page
│   │   │   ├── login/page.tsx         # Auth — login
│   │   │   ├── register/page.tsx      # Auth — register (multi-step for drivers)
│   │   │   ├── dashboard/page.tsx     # Passenger dashboard
│   │   │   ├── driver/page.tsx        # Driver dashboard
│   │   │   ├── notifications/page.tsx # Notifications list
│   │   │   └── profile/page.tsx       # User profile
│   │   ├── components/
│   │   │   ├── layout/navbar.tsx      # Role-aware sticky navbar
│   │   │   ├── map.tsx                # Leaflet map (SSR-safe)
│   │   │   ├── providers.tsx          # Query + Auth + Socket providers
│   │   │   └── ui/                    # Base UI + TailwindCSS components
│   │   ├── context/
│   │   │   ├── auth-context.tsx       # JWT state, login/logout
│   │   │   └── socket-context.tsx     # App-level socket lifecycle
│   │   ├── hooks/
│   │   │   └── use-require-auth.ts    # Protected route hook
│   │   └── lib/
│   │       ├── api.ts                 # Axios instance + interceptors
│   │       └── socket.ts              # Socket.IO helpers
│   ├── public/
│   └── package.json
│
├── backend/                           # NestJS 10 modular monolith
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/                  # JWT, bcrypt, guards, strategies
│   │   │   ├── rides/                 # Lifecycle, state machine, fare
│   │   │   ├── drivers/               # Profile, GEO, online/offline
│   │   │   ├── matching/              # BullMQ worker, GEO search
│   │   │   ├── gateway/               # Socket.IO gateways + middleware
│   │   │   │   ├── base.gateway.ts
│   │   │   │   ├── passenger.gateway.ts
│   │   │   │   ├── driver.gateway.ts
│   │   │   │   └── ride-events.service.ts
│   │   │   ├── notifications/         # Persistence + real-time delivery
│   │   │   ├── ratings/               # Post-completion reviews
│   │   │   ├── pricing/               # Fare engine (haversine)
│   │   │   ├── location/              # Persistence pipeline + stale cleanup
│   │   │   ├── redis/                 # RedisService, key schema
│   │   │   └── queue/                 # Queue names, job names, options
│   │   ├── common/
│   │   │   ├── decorators/            # @CurrentUser, @Roles
│   │   │   ├── guards/                # RolesGuard, DevOnlyGuard
│   │   │   └── types/                 # AuthenticatedUser, ApiSuccessResponse
│   │   ├── prisma/
│   │   │   └── prisma.service.ts
│   │   └── app.module.ts
│   ├── docs/                          # Architecture decision records
│   │   ├── ARCHITECTURE.md
│   │   ├── API_CONTRACTS.md
│   │   ├── REDIS_SCHEMA.md
│   │   ├── RIDE_STATE_MACHINE.md
│   │   ├── MATCHING_ENGINE.md
│   │   ├── SOCKET_PROTOCOL.md
│   │   └── RBAC.md
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── api-tests/                     # .http REST client tests
│   └── logs/
│
├── docker-compose.yml                 # PostgreSQL + Redis + Backend
└── README.md
```

---

## Security Model

```mermaid
graph LR
    subgraph Transport
        HTTPS["HTTPS / WSS<br/>TLS enforced"]
    end

    subgraph Auth["Authentication Layer"]
        JWT["JWT Verification<br/>JwtAuthGuard"]
        BCR["Password Hashing<br/>bcrypt rounds=12"]
        RL["Rate Limiting<br/>Redis INCR + TTL"]
    end

    subgraph Authz["Authorization Layer"]
        RBAC["Role Guard<br/>@Roles decorator"]
        OWN["Ownership Check<br/>DB — never JWT driverId"]
        DEV["DevOnlyGuard<br/>Dev endpoints blocked in prod"]
    end

    subgraph Validation["Input Validation"]
        DTO["class-validator DTOs<br/>All request bodies"]
        UUID["ParseUUIDPipe<br/>All :id params"]
        JOI["Joi env schema<br/>Startup validation"]
    end

    HTTPS --> JWT
    JWT --> RBAC
    RBAC --> OWN
    BCR --> JWT
    RL --> JWT
    DTO --> RBAC
    UUID --> RBAC
    JOI --> JWT
```

| Concern | Implementation |
|---------|---------------|
| Password storage | `bcrypt` with cost factor 12 |
| Token signing | JWT, secret via env var, validated at startup |
| Route protection | `JwtAuthGuard` at controller level |
| Role enforcement | `RolesGuard` + `@Roles()` at method level |
| Ownership | DB query — driverId from database, never trusted from JWT |
| Input validation | `class-validator` on all DTOs, `ParseUUIDPipe` on all `id` params |
| Rate limiting | Redis `INCR`/`EXPIRE` — 120 location updates/min per driver |
| Env validation | Joi schema checked at startup — server fails fast on misconfiguration |
| Dev endpoints | `DevOnlyGuard` — blocks `POST /rides/:id/assign` in production |

---

## Deployment

```mermaid
graph TB
    subgraph Vercel["Vercel — Frontend"]
        V_EDGE["Edge CDN<br/>Global PoPs"]
        V_SSG["Static Prerender<br/>All pages SSG"]
    end

    subgraph Render["Render — Backend"]
        R_WEB["Web Service<br/>NestJS + Socket.IO"]
        R_WORK["Background Workers<br/>BullMQ processors"]
    end

    subgraph Supabase["Supabase — PostgreSQL"]
        PG_DB[("PostgreSQL 16<br/>Managed + Backups")]
    end

    subgraph Upstash["Upstash — Redis"]
        UP_RD[("Redis<br/>Serverless + REST")]
    end

    GIT["GitHub<br/>Main Branch"] -->|push| Vercel & Render
    V_EDGE --> R_WEB
    R_WEB & R_WORK --> PG_DB & UP_RD
```

### Environment Variables

<details>
<summary>Backend (.env)</summary>

```env
# Application
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL=postgresql://user:pass@host:5432/campusflow

# Redis
REDIS_URL=redis://default:pass@host:6379

# JWT
JWT_SECRET=your-secret-here

# Pricing
FARE_BASE=30
FARE_PER_KM=20

# Matching
MATCHING_RADIUS_KM=5
MATCHING_ACCEPTANCE_WINDOW_MS=15000
```

</details>

<details>
<summary>Frontend (.env.local)</summary>

```env
NEXT_PUBLIC_API_URL=https://campusflow-y2g2.onrender.com/api/v1
NEXT_PUBLIC_SOCKET_URL=https://campusflow-y2g2.onrender.com
```

</details>

### Local Development

```bash
# 1. Clone and install
git clone https://github.com/your-org/campusflow
cd campusflow

# 2. Start infrastructure
docker compose up -d   # PostgreSQL + Redis

# 3. Backend
cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run start:dev

# 4. Frontend
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

---

## Known Issues

<details>
<summary><strong>WebSocket Namespace — Intermittent Connection Failures</strong></summary>

**Symptoms**
- `Invalid namespace` errors on initial connect
- Socket reconnects loop on cold start

**Root Cause**  
Socket.IO's Redis adapter requires the Redis connection to be fully established before namespace registration. On Render's free tier, cold starts introduce a ~2s Redis connection delay, causing the first WebSocket handshake to fail. Subsequent connections succeed via Socket.IO's built-in exponential backoff.

**Status** — Investigating Redis readiness probe at startup

**Workaround** — `reconnectionDelay: 1000, reconnectionDelayMax: 30000` on the client ensures automatic recovery within 1–5 seconds.

</details>

<details>
<summary><strong>Ride Request Flow — Occasional Matching Delay</strong></summary>

**Symptoms**
- Ride stays in `SEARCHING` state for longer than expected
- Driver receives assignment 10–30s after request

**Root Cause**  
Render free tier instances spin down after 15 minutes of inactivity. The BullMQ worker is co-located with the API server. On cold start, the first matching job may be picked up only after the worker process warms up.

**Status** — Investigating dedicated worker process separation

**Workaround** — Ping the health endpoint (`/health`) before demo to ensure warm instance.

</details>

<details>
<summary><strong>Driver Location Streaming — GPS Fallback on Non-Mobile Browsers</strong></summary>

**Symptoms**
- Driver dashboard uses Bangalore campus coordinates (12.97°N, 77.59°E) instead of real GPS

**Root Cause**  
`navigator.geolocation` requires HTTPS and user permission. Desktop browsers on localhost return the system's IP-based location or deny access entirely. The fallback is intentional for demo purposes.

**Status** — Expected behavior in desktop demo environment

</details>

---

## Engineering Lessons

> Real production problems solved during this build.

| Problem | Root Cause | Solution |
|---------|-----------|----------|
| Auth state instability | Axios interceptor called `window.location.href` on every 401, bypassing React state | Dispatch custom `auth:unauthorized` event; AuthContext calls `logout()` cleanly via React state |
| Socket reconnect loops | Sockets managed per-page in `useEffect` — disconnected on every navigation | Lifted to `SocketProvider` at app level; pages attach/remove listeners only |
| Stale ride card after completion | React Query retains last successful `data` on 404 refetch (`throwOnError: false`) | `queryFn` catches 404 and returns `null` explicitly, clearing the card |
| Driver 403 on active ride fetch | `GET /rides/active` restricted to PASSENGER role; driver was calling it | Added `GET /rides/driver-active` endpoint with DRIVER role guard |
| Duplicate `complete` requests | After successful completion, React Query refetch returned 404 but stale data remained, allowing second click | `queryFn` returns `null` on 404 instead of throwing |
| Base UI `MenuGroupLabel` crash | `DropdownMenuLabel` wraps Base UI's `Menu.GroupLabel` which requires `Menu.Group` parent | Replaced with plain `<div>` |
| JWT `driverId` missing on socket | Driver registered but never created driver profile; JWT lacked `driverId` claim | Frontend chains: register → login → driver profile → re-login to get fresh JWT |

---

## Roadmap

```mermaid
gantt
    title CampusFlow Engineering Roadmap
    dateFormat  YYYY-MM
    section Completed
    Infrastructure & Auth          :done, 2026-01, 1M
    Ride Lifecycle (3A/3B/3C)      :done, 2026-02, 1M
    Real-Time Layer                :done, 2026-03, 1M
    In-App Notifications           :done, 2026-03, 2w
    Pricing Engine                 :done, 2026-04, 2w
    Ratings & Reviews              :done, 2026-04, 2w
    Live Tracking                  :done, 2026-05, 1M
    Frontend MVP                   :done, 2026-06, 1M

    section Phase 4 — Intelligence
    ETA Prediction                 :2026-07, 3w
    Dynamic Surge Pricing          :2026-07, 3w
    Push Notifications (FCM)       :2026-08, 2w
    Driver Earnings Dashboard      :2026-08, 2w

    section Phase 5 — Scale
    Multi-Campus Support           :2026-09, 1M
    Admin Analytics Dashboard      :2026-09, 1M
    Scheduled Rides                :2026-10, 3w
    Ride Pooling                   :2026-10, 3w

    section Phase 6 — Monetization
    Payment Gateway (Razorpay)     :2026-11, 1M
    Driver Payouts                 :2026-11, 3w
    Referral System                :2026-12, 2w
```

---

## Resume Impact

> What this project demonstrates to a technical interviewer.

### System Design

- Designed and implemented a **distributed, event-driven system** from scratch — not following a tutorial
- Built a **strict ride lifecycle state machine** (11 states, 14 transitions) enforced at the service layer
- Implemented **Redis GEO-based driver matching** with weighted candidate ranking and distributed locks
- Designed a **dual-write consistency pattern** — Redis for speed, PostgreSQL as source of truth with explicit fallback paths

### Backend Engineering

- **NestJS modular monolith** with 10 feature modules, strict dependency injection
- **BullMQ job orchestration** — delayed jobs, repeatable workers, retry strategies
- **Socket.IO with Redis adapter** — multi-namespace, JWT auth middleware, room management
- **Prisma ORM** with typed repositories — zero direct Prisma access outside the data layer
- **Rate limiting** via Redis INCR/EXPIRE — enforced per-driver, per-endpoint

### Frontend Engineering

- **Next.js 16 App Router** with TypeScript, TailwindCSS, and Base UI
- **TanStack React Query** for server state — stale-while-revalidate, background sync, optimistic invalidation
- **App-level socket lifecycle** — single connection per role, survives page navigation, reconnects on auth state change
- **Leaflet + OpenStreetMap** integration with SSR-safe dynamic imports

### Infrastructure

- **Docker Compose** for local dev parity
- **Deployed to Render + Vercel + Upstash** — zero-downtime deploys from Git
- **Joi env schema validation** — server fails fast on misconfiguration in any environment

### Scale Indicators

| Metric | Value |
|--------|-------|
| API endpoints | 25+ |
| Socket events | 12 |
| BullMQ job types | 4 |
| DB migrations | 7+ |
| Redis key patterns | 14 |
| State machine transitions | 14 |
| Frontend pages | 8 |
| TypeScript coverage | 100% |

---

<div align="center">

Built with precision. Deployed with confidence.

**[campusflow-six-chi.vercel.app](https://campusflow-six-chi.vercel.app)**

</div>
