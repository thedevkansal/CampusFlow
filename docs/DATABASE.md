# Database Design

## users

id
name
email
password_hash
role
created_at

## drivers

id
user_id
vehicle_number
rating
status
created_at

## driver_locations

id
driver_id
latitude
longitude
updated_at

## rides

id
passenger_id
pickup_lat
pickup_lng
destination_lat
destination_lng
status
requested_at
completed_at

## ride_assignments

id
ride_id
driver_id
assigned_at
accepted_at

## ride_events

id
ride_id
event_type
payload
created_at

Events:

REQUESTED

ASSIGNED

ACCEPTED

STARTED

COMPLETED

CANCELLED

## ratings

id
ride_id
driver_id
passenger_id
rating
comment

## notifications

id
user_id
type
payload
is_read

## analytics_events

id
event_name
payload
created_at

## demand_predictions

id
zone
prediction_time
predicted_rides
created_at