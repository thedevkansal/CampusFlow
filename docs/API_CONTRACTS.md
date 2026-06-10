# API Contracts

Base URL

/api/v1

## Auth

POST /auth/register

POST /auth/login

GET /auth/profile

## Drivers

POST /drivers/online

POST /drivers/offline

PATCH /drivers/location

GET /drivers/profile

## Rides

POST /rides

GET /rides/:id

POST /rides/:id/cancel

POST /rides/:id/accept

POST /rides/:id/start

POST /rides/:id/complete

## Ratings

POST /ratings

GET /ratings/driver/:id

## Analytics

GET /analytics/dashboard

GET /analytics/demand

GET /analytics/hotspots

## Response Format

{
  success: true,
  data: {},
  message: ""
}

## Error Format

{
  success: false,
  error: "",
  code: ""
}