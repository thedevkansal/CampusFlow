-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PASSENGER', 'DRIVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ONLINE', 'OFFLINE', 'BUSY');

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM (
  'REQUESTED', 'SEARCHING', 'ASSIGNED', 'ACCEPTED', 'ARRIVING',
  'IN_PROGRESS', 'COMPLETED', 'NO_DRIVER_FOUND', 'TIMED_OUT',
  'PASSENGER_CANCELLED', 'DRIVER_CANCELLED', 'DISPUTED'
);

-- CreateEnum
CREATE TYPE "RideEventType" AS ENUM (
  'REQUESTED', 'SEARCHING', 'ASSIGNED', 'ACCEPTED', 'ARRIVING',
  'STARTED', 'COMPLETED', 'NO_DRIVER_FOUND', 'TIMED_OUT',
  'PASSENGER_CANCELLED', 'DRIVER_CANCELLED', 'DISPUTED', 'REMATCHED'
);

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('PASSENGER', 'DRIVER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
  'RIDE_ASSIGNED', 'RIDE_ACCEPTED', 'RIDE_ARRIVING', 'RIDE_STARTED',
  'RIDE_COMPLETED', 'RIDE_CANCELLED', 'RIDE_NO_DRIVER', 'RIDE_TIMED_OUT',
  'RIDE_DISPUTED', 'DRIVER_RATED', 'EARNINGS_UPDATED', 'SYSTEM'
);

-- Enable PostGIS (run AFTER this migration if PostGIS is available)
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateTable: users
CREATE TABLE "users" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "name"          VARCHAR(100) NOT NULL,
  "email"         VARCHAR(255) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "role"          "UserRole" NOT NULL DEFAULT 'PASSENGER',
  "is_active"     BOOLEAN NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateTable: refresh_tokens
CREATE TABLE "refresh_tokens" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      UUID NOT NULL,
  "token_family" VARCHAR(255) NOT NULL,
  "token_hash"   VARCHAR(255) NOT NULL,
  "expires_at"   TIMESTAMP(3) NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at"   TIMESTAMP(3),
  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_token_family_idx" ON "refresh_tokens"("token_family");

-- CreateTable: drivers
CREATE TABLE "drivers" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"        UUID NOT NULL,
  "vehicle_number" VARCHAR(20) NOT NULL,
  "vehicle_model"  VARCHAR(100),
  "vehicle_color"  VARCHAR(50),
  "rating"         DECIMAL(3,2) NOT NULL DEFAULT 5.0,
  "total_ratings"  INTEGER NOT NULL DEFAULT 0,
  "status"         "DriverStatus" NOT NULL DEFAULT 'OFFLINE',
  "is_verified"    BOOLEAN NOT NULL DEFAULT false,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");
CREATE INDEX "drivers_status_idx" ON "drivers"("status");

-- CreateTable: driver_locations
CREATE TABLE "driver_locations" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "driver_id" UUID NOT NULL,
  "latitude"  DECIMAL(10,7) NOT NULL,
  "longitude" DECIMAL(10,7) NOT NULL,
  "heading"   DECIMAL(5,2),
  "speed"     DECIMAL(6,2),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "driver_locations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "driver_locations_driver_id_key" ON "driver_locations"("driver_id");
CREATE INDEX "driver_locations_lat_lng_idx" ON "driver_locations"("latitude", "longitude");
-- PostGIS GIST index (apply after enabling postgis extension):
-- CREATE INDEX "driver_locations_geo_idx" ON "driver_locations" USING GIST (ST_Point(longitude::float8, latitude::float8));

-- CreateTable: rides
CREATE TABLE "rides" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "passenger_id"       UUID NOT NULL,
  "pickup_lat"         DECIMAL(10,7) NOT NULL,
  "pickup_lng"         DECIMAL(10,7) NOT NULL,
  "pickup_address"     VARCHAR(255),
  "destination_lat"    DECIMAL(10,7) NOT NULL,
  "destination_lng"    DECIMAL(10,7) NOT NULL,
  "destination_address" VARCHAR(255),
  "status"             "RideStatus" NOT NULL DEFAULT 'REQUESTED',
  "requested_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at"       TIMESTAMP(3),
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rides_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rides_passenger_id_idx" ON "rides"("passenger_id");
CREATE INDEX "rides_status_idx" ON "rides"("status");
CREATE INDEX "rides_status_requested_at_idx" ON "rides"("status", "requested_at");

-- CreateTable: ride_assignments
CREATE TABLE "ride_assignments" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "ride_id"     UUID NOT NULL,
  "driver_id"   UUID NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at" TIMESTAMP(3),
  CONSTRAINT "ride_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ride_assignments_ride_id_key" ON "ride_assignments"("ride_id");
CREATE INDEX "ride_assignments_driver_id_idx" ON "ride_assignments"("driver_id");
CREATE INDEX "ride_assignments_driver_accepted_idx" ON "ride_assignments"("driver_id", "accepted_at");

-- CreateTable: ride_events
CREATE TABLE "ride_events" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "ride_id"    UUID NOT NULL,
  "event_type" "RideEventType" NOT NULL,
  "payload"    JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ride_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ride_events_ride_id_idx" ON "ride_events"("ride_id");
CREATE INDEX "ride_events_ride_id_created_at_idx" ON "ride_events"("ride_id", "created_at");

-- CreateTable: ride_fares
CREATE TABLE "ride_fares" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "ride_id"      UUID NOT NULL,
  "amount"       DECIMAL(10,2) NOT NULL,
  "currency"     VARCHAR(3) NOT NULL DEFAULT 'INR',
  "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ride_fares_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ride_fares_ride_id_key" ON "ride_fares"("ride_id");

-- CreateTable: cancellation_reasons
CREATE TABLE "cancellation_reasons" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "ride_id"      UUID NOT NULL,
  "driver_id"    UUID,
  "cancelled_by" "CancelledBy" NOT NULL,
  "reason_code"  VARCHAR(50) NOT NULL,
  "reason_text"  VARCHAR(200),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cancellation_reasons_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cancellation_reasons_ride_id_idx" ON "cancellation_reasons"("ride_id");

-- CreateTable: ratings
CREATE TABLE "ratings" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "ride_id"      UUID NOT NULL,
  "driver_id"    UUID NOT NULL,
  "passenger_id" UUID NOT NULL,
  "rating"       SMALLINT NOT NULL,
  "comment"      VARCHAR(500),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ratings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ratings_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "ratings_ride_id_key" ON "ratings"("ride_id");
CREATE INDEX "ratings_driver_id_idx" ON "ratings"("driver_id");

-- CreateTable: driver_earnings
CREATE TABLE "driver_earnings" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "driver_id" UUID NOT NULL,
  "ride_id"   UUID NOT NULL,
  "amount"    DECIMAL(10,2) NOT NULL,
  "currency"  VARCHAR(3) NOT NULL DEFAULT 'INR',
  "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "driver_earnings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "driver_earnings_driver_id_idx" ON "driver_earnings"("driver_id");
CREATE INDEX "driver_earnings_driver_earned_idx" ON "driver_earnings"("driver_id", "earned_at");

-- CreateTable: notifications
CREATE TABLE "notifications" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    UUID NOT NULL,
  "type"       "NotificationType" NOT NULL,
  "title"      VARCHAR(255) NOT NULL,
  "body"       VARCHAR(1000) NOT NULL,
  "payload"    JSONB,
  "is_read"    BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notifications_user_is_read_idx" ON "notifications"("user_id", "is_read");
CREATE INDEX "notifications_user_created_idx" ON "notifications"("user_id", "created_at");

-- CreateTable: analytics_events
CREATE TABLE "analytics_events" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_name" VARCHAR(100) NOT NULL,
  "payload"    JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "analytics_events_name_created_idx" ON "analytics_events"("event_name", "created_at");

-- CreateTable: demand_predictions
CREATE TABLE "demand_predictions" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "zone"            VARCHAR(100) NOT NULL,
  "prediction_time" TIMESTAMP(3) NOT NULL,
  "predicted_rides" INTEGER NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "demand_predictions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "demand_predictions_zone_time_idx" ON "demand_predictions"("zone", "prediction_time");

-- CreateTable: admin_actions
CREATE TABLE "admin_actions" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "admin_id"    UUID NOT NULL,
  "action"      VARCHAR(100) NOT NULL,
  "target_id"   UUID,
  "target_type" VARCHAR(50),
  "payload"     JSONB,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_actions_admin_id_idx" ON "admin_actions"("admin_id");
CREATE INDEX "admin_actions_action_created_idx" ON "admin_actions"("action", "created_at");

-- AddForeignKey constraints
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drivers"
  ADD CONSTRAINT "drivers_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "driver_locations"
  ADD CONSTRAINT "driver_locations_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rides"
  ADD CONSTRAINT "rides_passenger_id_fkey"
  FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON UPDATE CASCADE;

ALTER TABLE "ride_assignments"
  ADD CONSTRAINT "ride_assignments_ride_id_fkey"
  FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ride_assignments"
  ADD CONSTRAINT "ride_assignments_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON UPDATE CASCADE;

ALTER TABLE "ride_events"
  ADD CONSTRAINT "ride_events_ride_id_fkey"
  FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ride_fares"
  ADD CONSTRAINT "ride_fares_ride_id_fkey"
  FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cancellation_reasons"
  ADD CONSTRAINT "cancellation_reasons_ride_id_fkey"
  FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cancellation_reasons"
  ADD CONSTRAINT "cancellation_reasons_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON UPDATE CASCADE;

ALTER TABLE "ratings"
  ADD CONSTRAINT "ratings_ride_id_fkey"
  FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ratings"
  ADD CONSTRAINT "ratings_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON UPDATE CASCADE;

ALTER TABLE "driver_earnings"
  ADD CONSTRAINT "driver_earnings_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_actions"
  ADD CONSTRAINT "admin_actions_admin_id_fkey"
  FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON UPDATE CASCADE;
