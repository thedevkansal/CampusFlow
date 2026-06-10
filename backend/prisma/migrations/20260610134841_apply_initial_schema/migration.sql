-- DropForeignKey
ALTER TABLE "admin_actions" DROP CONSTRAINT "admin_actions_admin_id_fkey";

-- DropForeignKey
ALTER TABLE "cancellation_reasons" DROP CONSTRAINT "cancellation_reasons_driver_id_fkey";

-- DropForeignKey
ALTER TABLE "driver_earnings" DROP CONSTRAINT "driver_earnings_driver_id_fkey";

-- DropForeignKey
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_driver_id_fkey";

-- DropForeignKey
ALTER TABLE "ride_assignments" DROP CONSTRAINT "ride_assignments_driver_id_fkey";

-- DropForeignKey
ALTER TABLE "rides" DROP CONSTRAINT "rides_passenger_id_fkey";

-- AlterTable
ALTER TABLE "admin_actions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "analytics_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "cancellation_reasons" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "demand_predictions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "driver_earnings" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "driver_locations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "drivers" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ratings" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ride_assignments" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ride_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ride_fares" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "rides" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "driver_locations_driver_id_idx" ON "driver_locations"("driver_id");

-- CreateIndex
CREATE INDEX "drivers_user_id_idx" ON "drivers"("user_id");

-- CreateIndex
CREATE INDEX "ride_assignments_ride_id_idx" ON "ride_assignments"("ride_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_assignments" ADD CONSTRAINT "ride_assignments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_reasons" ADD CONSTRAINT "cancellation_reasons_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "admin_actions_action_created_idx" RENAME TO "admin_actions_action_created_at_idx";

-- RenameIndex
ALTER INDEX "analytics_events_name_created_idx" RENAME TO "analytics_events_event_name_created_at_idx";

-- RenameIndex
ALTER INDEX "demand_predictions_zone_time_idx" RENAME TO "demand_predictions_zone_prediction_time_idx";

-- RenameIndex
ALTER INDEX "driver_earnings_driver_earned_idx" RENAME TO "driver_earnings_driver_id_earned_at_idx";

-- RenameIndex
ALTER INDEX "driver_locations_lat_lng_idx" RENAME TO "driver_locations_latitude_longitude_idx";

-- RenameIndex
ALTER INDEX "notifications_user_created_idx" RENAME TO "notifications_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "notifications_user_is_read_idx" RENAME TO "notifications_user_id_is_read_idx";

-- RenameIndex
ALTER INDEX "ride_assignments_driver_accepted_idx" RENAME TO "ride_assignments_driver_id_accepted_at_idx";
