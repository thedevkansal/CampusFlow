/*
  Warnings:

  - You are about to drop the column `driver_id` on the `ratings` table. All the data in the column will be lost.
  - You are about to drop the column `passenger_id` on the `ratings` table. All the data in the column will be lost.
  - You are about to drop the column `rating` on the `ratings` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[ride_id,reviewer_id]` on the table `ratings` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `reviewee_id` to the `ratings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `reviewer_id` to the `ratings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `score` to the `ratings` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_driver_id_fkey";

-- DropIndex
DROP INDEX "ratings_driver_id_idx";

-- DropIndex
DROP INDEX "ratings_ride_id_key";

-- AlterTable
ALTER TABLE "ratings" DROP COLUMN "driver_id",
DROP COLUMN "passenger_id",
DROP COLUMN "rating",
ADD COLUMN     "reviewee_id" UUID NOT NULL,
ADD COLUMN     "reviewer_id" UUID NOT NULL,
ADD COLUMN     "score" SMALLINT NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "average_rating" DECIMAL(3,2) NOT NULL DEFAULT 5.0,
ADD COLUMN     "total_ratings" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ratings_reviewee_id_idx" ON "ratings"("reviewee_id");

-- CreateIndex
CREATE INDEX "ratings_ride_id_idx" ON "ratings"("ride_id");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_ride_id_reviewer_id_key" ON "ratings"("ride_id", "reviewer_id");

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_reviewee_id_fkey" FOREIGN KEY ("reviewee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
