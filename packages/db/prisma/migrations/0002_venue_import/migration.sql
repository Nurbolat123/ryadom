/*
  Warnings:

  - You are about to drop the column `location` on the `VenueSuggestion` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "GeofenceKind" AS ENUM ('building', 'circle', 'manual');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('running', 'success', 'failed');

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "geofenceKind" "GeofenceKind" NOT NULL DEFAULT 'circle';

-- AlterTable
ALTER TABLE "VenueSuggestion" DROP COLUMN "location";

-- CreateTable
CREATE TABLE "VenueImportRun" (
    "id" TEXT NOT NULL,
    "source" "VenueSourceKind" NOT NULL,
    "city" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "deactivated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "VenueImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VenueImportRun_source_city_startedAt_idx" ON "VenueImportRun"("source", "city", "startedAt");

-- Счётчики импорта неотрицательны.
ALTER TABLE "VenueImportRun" ADD CONSTRAINT "VenueImportRun_counts_nonneg" CHECK (
  "fetched" >= 0 AND "skipped" >= 0 AND "created" >= 0 AND "updated" >= 0 AND "deactivated" >= 0
);
