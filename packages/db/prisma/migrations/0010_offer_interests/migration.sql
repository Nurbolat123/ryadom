-- Показ предложений по интересам (только при согласии человека, правило 14).

-- CreateTable
CREATE TABLE "OfferInterest" (
    "offerId" TEXT NOT NULL,
    "interestId" TEXT NOT NULL,

    CONSTRAINT "OfferInterest_pkey" PRIMARY KEY ("offerId","interestId")
);

-- CreateIndex
CREATE INDEX "OfferInterest_interestId_idx" ON "OfferInterest"("interestId");

-- AddForeignKey
ALTER TABLE "OfferInterest" ADD CONSTRAINT "OfferInterest_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferInterest" ADD CONSTRAINT "OfferInterest_interestId_fkey" FOREIGN KEY ("interestId") REFERENCES "Interest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

