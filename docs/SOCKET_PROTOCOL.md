# Socket Protocol

## Connection

JWT required.

Socket authentication middleware mandatory.

## Passenger Events

ride:create

ride:cancel

ride:status

## Driver Events

driver:online

driver:offline

driver:location

ride:accept

ride:reject

## Server Events

ride:assigned

ride:accepted

ride:started

ride:completed

ride:cancelled

driver:update

## Location Payload

{
  driverId,
  latitude,
  longitude,
  timestamp
}

## Reliability

Acknowledgements mandatory.

Reconnect handling mandatory.

Missed events fetched from database.

Redis pub/sub used for multi-instance communication.