# System Architecture

## Overview

CampusFlow is a real-time ride-hailing platform.

Architecture follows modular monolith principles.

## Frontend

Next.js

Responsibilities:

- Authentication
- Ride booking
- Driver dashboard
- Live maps

## Backend

NestJS

Modules:

Auth

Users

Drivers

Rides

Matching

Analytics

Notifications

## Database

PostgreSQL

Source of truth.

## Cache

Redis

Used for:

- Driver availability
- Active rides
- Pub/Sub

## Queue

BullMQ

Used for:

- Notifications
- Analytics processing
- Forecasting jobs

## Realtime Layer

Socket.IO

Responsibilities:

- Ride updates
- Driver locations
- Assignment events

## Matching Service

Consumes ride request events.

Selects optimal drivers.

Handles assignment.

## Maps

Leaflet

OpenStreetMap

## Monitoring

Sentry

PostHog

## Deployment

Docker

GitHub Actions

VPS Deployment

## Scalability

Stateless backend.

Horizontal scaling.

Redis-backed socket communication.

Database indexing.

Queue-based background processing.