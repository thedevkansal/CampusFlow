# Driver Matching Engine

## Goal

Assign the best nearby driver while preventing duplicate assignment.

## Matching Inputs

Driver location.

Driver availability.

Driver rating.

Driver acceptance rate.

Distance from passenger.

## Assignment Flow

1. Passenger creates ride.

2. Ride stored in database.

3. Event published to Redis.

4. Matching service triggered.

5. Nearby drivers fetched.

6. Drivers ranked.

Ranking Score:

distance_weight

rating_weight

acceptance_rate_weight

7. Top drivers notified.

8. First driver to accept wins.

9. Database transaction locks ride.

10. Assignment finalized.

## Race Condition Prevention

Use PostgreSQL transaction.

Only one ACCEPT action allowed.

All subsequent requests rejected.

## Future Improvements

Demand-aware matching.

Zone balancing.

Driver load balancing.