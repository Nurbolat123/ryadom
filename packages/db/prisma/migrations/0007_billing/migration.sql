-- AlterEnum


ALTER TYPE "NoticeKind" ADD VALUE 'plus_renewal_reminder';
ALTER TYPE "NoticeKind" ADD VALUE 'plus_renewed';
ALTER TYPE "NoticeKind" ADD VALUE 'plus_renewal_failed';

-- AlterTable
ALTER TABLE "Entitlement" ADD COLUMN     "plusSuperUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "plusWeekStart" TIMESTAMP(3),
ADD COLUMN     "renewalRemindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Notice" ALTER COLUMN "venueId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "autoRenew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "giftDraft" JSONB,
ADD COLUMN     "giftId" TEXT,
ADD COLUMN     "isRenewal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'stub',
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ALTER COLUMN "product" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_giftId_key" ON "Purchase"("giftId");

-- CreateIndex
CREATE INDEX "Purchase_status_createdAt_idx" ON "Purchase"("status", "createdAt");


-- Покупка — это либо продукт («Плюс», суперприветы), либо подарок.
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_product_or_gift" CHECK (("product" IS NULL) <> ("giftDraft" IS NULL));
-- Автопродление — только у месячных тарифов и только с согласия (по умолчанию выключено).
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_autorenew_monthly" CHECK (NOT "autoRenew" OR "product" IN ('plus_month', 'plus_3months'));
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_autorenew_monthly" CHECK (NOT "autoRenew" OR "autoRenewProduct" IN ('plus_month', 'plus_3months'));
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_counts" CHECK ("superHellos" >= 0 AND "plusSuperUsed" >= 0);
-- Анонимная симпатия всегда привязана к заведению.
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_sympathy_has_venue" CHECK ("kind" <> 'sympathy_anonymous' OR "venueId" IS NOT NULL);
