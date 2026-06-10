# Engineering Rules

This project must be built as a production-grade real-time ride-hailing platform, not as a CRUD college project.

## Core Principles

1. Consistency over feature count.
2. Backend quality over UI complexity.
3. Explicit contracts over assumptions.
4. Event-driven architecture where applicable.
5. Every major action must be traceable.

## Tech Stack

Frontend:
- Next.js 16
- TypeScript
- Tailwind
- Shadcn

Backend:
- NestJS
- TypeScript

Database:
- PostgreSQL
- Prisma

Cache:
- Redis

Realtime:
- Socket.IO

Queue:
- BullMQ

Maps:
- Leaflet
- OpenStreetMap

## Code Rules

- Strict TypeScript.
- No any types.
- DTO validation mandatory.
- Repository pattern.
- Service layer abstraction.
- No business logic in controllers.
- Modular architecture.

## AI Rules

Before generating code:

1. Read all docs.
2. Respect existing contracts.
3. Do not modify schema without approval.
4. Do not introduce duplicate concepts.
5. Maintain consistency across backend, frontend and sockets.

## Performance Targets

API latency:
<200ms

Socket latency:
<100ms

Ride assignment:
<3 seconds

Concurrent users:
500+

## Security

JWT authentication.

Role-based authorization.

Input validation.

Rate limiting.

Secure websocket authentication.

Environment variables only.

No secrets in source code.