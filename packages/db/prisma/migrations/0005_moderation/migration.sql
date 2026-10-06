
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "ReportAction" AS ENUM ('dismissed', 'photo_removed', 'banned');

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "action" "ReportAction",
ADD COLUMN     "resolvedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bannedAt" TIMESTAMP(3),
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'user';


-- Рассмотренная жалоба всегда с действием, нерассмотренная — без.
ALTER TABLE "Report" ADD CONSTRAINT "Report_action_matches_status" CHECK (
  ("status" = 'pending' AND "action" IS NULL) OR ("status" <> 'pending' AND "action" IS NOT NULL)
);
