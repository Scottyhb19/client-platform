/*
  Warnings:

  - You are about to drop the column `date` on the `bookings` table. All the data in the column will be lost.
  - You are about to drop the column `endTime` on the `bookings` table. All the data in the column will be lost.
  - Added the required column `durationMinutes` to the `bookings` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `startTime` on the `bookings` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropIndex
DROP INDEX "bookings_date_idx";

-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "date",
DROP COLUMN "endTime",
ADD COLUMN     "durationMinutes" INTEGER NOT NULL,
DROP COLUMN "startTime",
ADD COLUMN     "startTime" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "bookings_startTime_idx" ON "bookings"("startTime");
