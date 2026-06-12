/*
  Warnings:

  - Added the required column `distance_km` to the `ride_fares` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ride_fares" ADD COLUMN     "distance_km" DECIMAL(10,3) NOT NULL;

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "estimated_distance_km" DECIMAL(10,3),
ADD COLUMN     "estimated_fare" DECIMAL(10,2);
