-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "descriptionKk" VARCHAR(500),
ADD COLUMN     "titleKk" VARCHAR(80);

-- AlterTable
ALTER TABLE "OfferRedemption" ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "OfferStatsDaily" (
    "offerId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OfferStatsDaily_pkey" PRIMARY KEY ("offerId","day")
);

-- AddForeignKey
ALTER TABLE "OfferStatsDaily" ADD CONSTRAINT "OfferStatsDaily_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Предложение: конец позже начала; счётчики не отрицательные.
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_period" CHECK ("endsAt" > "startsAt");
ALTER TABLE "OfferStatsDaily" ADD CONSTRAINT "OfferStatsDaily_counts" CHECK ("impressions" >= 0 AND "clicks" >= 0);
ALTER TABLE "VenueStatsHourly" ADD CONSTRAINT "VenueStatsHourly_hour" CHECK ("hour" BETWEEN 0 AND 23 AND "openPeak" >= 0 AND "checkins" >= 0);
