-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- PostGIS: точки и геозоны заведений.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('ru', 'kk');

-- CreateEnum
CREATE TYPE "VenueCategory" AS ENUM ('cafe', 'coffee', 'bar', 'restaurant', 'coworking', 'event', 'other');

-- CreateEnum
CREATE TYPE "VenueSourceKind" AS ENUM ('seed', 'osm', 'dgis', 'user', 'admin');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('discount', 'event', 'promo');

-- CreateEnum
CREATE TYPE "OfferPlacement" AS ENUM ('badge', 'promo_card', 'event_of_day');

-- CreateEnum
CREATE TYPE "HelloStatus" AS ENUM ('pending', 'replied', 'dismissed');

-- CreateEnum
CREATE TYPE "GiftStatus" AS ENUM ('pending', 'accepted', 'redeemed', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "GiftDelivery" AS ENUM ('pickup', 'table');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "ProductCode" AS ENUM ('plus_evening', 'plus_week', 'plus_month', 'plus_3months', 'super_hello_1', 'super_hello_5');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('fake_profile', 'harassment', 'underage', 'spam', 'inappropriate', 'other');

-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('app_open', 'registered', 'checkin', 'open_to_meet_on', 'sympathy_sent', 'hello_sent', 'super_hello_sent', 'gift_sent', 'match', 'hello_replied', 'gift_accepted', 'gift_redeemed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "birthDate" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "displayName" VARCHAR(40) NOT NULL,
    "about" VARCHAR(120),
    "photo" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "locale" "Locale" NOT NULL DEFAULT 'ru',
    "countryCode" CHAR(2) NOT NULL DEFAULT 'KZ',
    "adsConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interest" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameKk" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Interest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInterest" (
    "userId" TEXT NOT NULL,
    "interestId" TEXT NOT NULL,

    CONSTRAINT "UserInterest_pkey" PRIMARY KEY ("userId","interestId")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "VenueCategory" NOT NULL,
    "address" TEXT,
    "city" TEXT NOT NULL,
    "location" geography(Point, 4326),
    "geofence" geography(Polygon, 4326),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
    "source" "VenueSourceKind" NOT NULL,
    "sourceId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "isPartner" BOOLEAN NOT NULL DEFAULT false,
    "telegramChatId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "commissionPct" DECIMAL(5,2),
    "maxGiftAmount" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'KZT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "category" "VenueCategory",
    "address" TEXT,
    "city" TEXT NOT NULL,
    "comment" VARCHAR(300),
    "location" geography(Point, 4326),
    "status" "ModerationStatus" NOT NULL DEFAULT 'pending',
    "venueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "VenueSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueStatsHourly" (
    "venueId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hour" SMALLINT NOT NULL,
    "openPeak" INTEGER NOT NULL DEFAULT 0,
    "checkins" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VenueStatsHourly_pkey" PRIMARY KEY ("venueId","date","hour")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKk" TEXT,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'KZT',
    "isAlcohol" BOOLEAN NOT NULL DEFAULT false,
    "giftable" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "type" "OfferType" NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "placement" "OfferPlacement" NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "status" "ModerationStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferRedemption" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "OfferRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sympathy" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "noticeSentAt" TIMESTAMP(3),

    CONSTRAINT "Sympathy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hello" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "isSuper" BOOLEAN NOT NULL DEFAULT false,
    "message" VARCHAR(200) NOT NULL,
    "status" "HelloStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "Hello_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "matchId" TEXT,
    "helloId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactExchange" (
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactExchange_pkey" PRIMARY KEY ("chatId","userId")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "product" "ProductCode" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "product" "ProductCode" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "userId" TEXT NOT NULL,
    "plusUntil" TIMESTAMP(3),
    "superHellos" INTEGER NOT NULL DEFAULT 0,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "autoRenewProduct" "ProductCode",
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Gift" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "venueId" TEXT NOT NULL,
    "visitId" TEXT,
    "menuItemId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'KZT',
    "note" VARCHAR(100),
    "status" "GiftStatus" NOT NULL DEFAULT 'pending',
    "delivery" "GiftDelivery",
    "pickupCode" TEXT,
    "tableNumber" VARCHAR(10),
    "paymentId" TEXT,
    "refundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "Gift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT,
    "reportedId" TEXT,
    "venueId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "comment" VARCHAR(500),
    "status" "ModerationStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" BIGSERIAL NOT NULL,
    "type" "AnalyticsEventType" NOT NULL,
    "venueId" TEXT,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Interest_slug_key" ON "Interest"("slug");

-- CreateIndex
CREATE INDEX "UserInterest_interestId_idx" ON "UserInterest"("interestId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_slug_key" ON "Venue"("slug");

-- CreateIndex
CREATE INDEX "Venue_city_isActive_idx" ON "Venue"("city", "isActive");

-- CreateIndex
CREATE INDEX "Venue_isPartner_idx" ON "Venue"("isPartner");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_source_sourceId_key" ON "Venue"("source", "sourceId");

-- CreateIndex
CREATE INDEX "VenueSuggestion_status_createdAt_idx" ON "VenueSuggestion"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MenuItem_venueId_giftable_isAvailable_idx" ON "MenuItem"("venueId", "giftable", "isAvailable");

-- CreateIndex
CREATE INDEX "Offer_venueId_status_startsAt_endsAt_idx" ON "Offer"("venueId", "status", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferRedemption_code_key" ON "OfferRedemption"("code");

-- CreateIndex
CREATE INDEX "OfferRedemption_offerId_idx" ON "OfferRedemption"("offerId");

-- CreateIndex
CREATE INDEX "Visit_userId_startedAt_idx" ON "Visit"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "Visit_venueId_startedAt_idx" ON "Visit"("venueId", "startedAt");

-- CreateIndex
CREATE INDEX "Sympathy_toUserId_idx" ON "Sympathy"("toUserId");

-- CreateIndex
CREATE INDEX "Sympathy_expiresAt_idx" ON "Sympathy"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sympathy_fromUserId_toUserId_key" ON "Sympathy"("fromUserId", "toUserId");

-- CreateIndex
CREATE INDEX "Match_userBId_idx" ON "Match"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_userAId_userBId_key" ON "Match"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "Hello_toUserId_status_isSuper_createdAt_idx" ON "Hello"("toUserId", "status", "isSuper", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Hello_fromUserId_toUserId_key" ON "Hello"("fromUserId", "toUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_matchId_key" ON "Chat"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_helloId_key" ON "Chat"("helloId");

-- CreateIndex
CREATE INDEX "Chat_userBId_idx" ON "Chat"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_userAId_userBId_key" ON "Chat"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "Message_chatId_createdAt_idx" ON "Message"("chatId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Price_countryCode_product_key" ON "Price"("countryCode", "product");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_paymentId_key" ON "Purchase"("paymentId");

-- CreateIndex
CREATE INDEX "Purchase_userId_createdAt_idx" ON "Purchase"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Gift_paymentId_key" ON "Gift"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Gift_refundId_key" ON "Gift"("refundId");

-- CreateIndex
CREATE INDEX "Gift_fromUserId_createdAt_idx" ON "Gift"("fromUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Gift_toUserId_status_idx" ON "Gift"("toUserId", "status");

-- CreateIndex
CREATE INDEX "Gift_venueId_createdAt_idx" ON "Gift"("venueId", "createdAt");

-- CreateIndex
CREATE INDEX "Gift_status_expiresAt_idx" ON "Gift"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Block_blockedId_idx" ON "Block"("blockedId");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_reportedId_idx" ON "Report"("reportedId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_venueId_day_type_idx" ON "AnalyticsEvent"("venueId", "day", "type");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_day_type_idx" ON "AnalyticsEvent"("day", "type");

-- AddForeignKey
ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_interestId_fkey" FOREIGN KEY ("interestId") REFERENCES "Interest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueSuggestion" ADD CONSTRAINT "VenueSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueSuggestion" ADD CONSTRAINT "VenueSuggestion_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueStatsHourly" ADD CONSTRAINT "VenueStatsHourly_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sympathy" ADD CONSTRAINT "Sympathy_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sympathy" ADD CONSTRAINT "Sympathy_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sympathy" ADD CONSTRAINT "Sympathy_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hello" ADD CONSTRAINT "Hello_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hello" ADD CONSTRAINT "Hello_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hello" ADD CONSTRAINT "Hello_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_helloId_fkey" FOREIGN KEY ("helloId") REFERENCES "Hello"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactExchange" ADD CONSTRAINT "ContactExchange_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactExchange" ADD CONSTRAINT "ContactExchange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ───────────────────────── Дописано вручную: то, что Prisma не умеет выражать ─────────────────────────

-- Геоиндексы для поиска заведения по точке (чек-ин).
CREATE INDEX "Venue_geofence_gist" ON "Venue" USING GIST ("geofence");
CREATE INDEX "Venue_location_gist" ON "Venue" USING GIST ("location");

-- У заведения всегда есть точка.
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_location_required" CHECK ("location" IS NOT NULL);
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_commission_range" CHECK ("commissionPct" IS NULL OR ("commissionPct" >= 0 AND "commissionPct" <= 100));
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_maxGift_positive" CHECK ("maxGiftAmount" IS NULL OR "maxGiftAmount" > 0);

-- Правило 8: алкоголь нельзя подарить.
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_no_alcohol_gifts" CHECK (NOT ("giftable" AND "isAlcohol"));
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_price_positive" CHECK ("price" > 0);

-- Профиль: «о себе» до 120 символов.
ALTER TABLE "User" ADD CONSTRAINT "User_about_length" CHECK ("about" IS NULL OR char_length("about") <= 120);

-- Нельзя адресовать действие самому себе.
ALTER TABLE "Sympathy" ADD CONSTRAINT "Sympathy_not_self" CHECK ("fromUserId" <> "toUserId");
ALTER TABLE "Hello" ADD CONSTRAINT "Hello_not_self" CHECK ("fromUserId" <> "toUserId");
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_not_self" CHECK ("fromUserId" IS NULL OR "toUserId" IS NULL OR "fromUserId" <> "toUserId");
ALTER TABLE "Block" ADD CONSTRAINT "Block_not_self" CHECK ("blockerId" <> "blockedId");
ALTER TABLE "Report" ADD CONSTRAINT "Report_not_self" CHECK ("reporterId" IS NULL OR "reportedId" IS NULL OR "reporterId" <> "reportedId");

-- Пары в Match и Chat хранятся упорядоченно — одна запись на пару.
ALTER TABLE "Match" ADD CONSTRAINT "Match_ordered_pair" CHECK ("userAId" < "userBId");
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_ordered_pair" CHECK ("userAId" < "userBId");

-- Привет до 100 символов, суперпривет до 200.
ALTER TABLE "Hello" ADD CONSTRAINT "Hello_message_length" CHECK (
  char_length("message") >= 1 AND char_length("message") <= CASE WHEN "isSuper" THEN 200 ELSE 100 END
);

-- Подарок: сумма и комиссия неотрицательны, комиссия не больше суммы.
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_amounts" CHECK ("amount" > 0 AND "commission" >= 0 AND "commission" <= "amount");

-- Цены и покупки положительные.
ALTER TABLE "Price" ADD CONSTRAINT "Price_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_superHellos_nonneg" CHECK ("superHellos" >= 0);

-- Статистика по часам: час 0–23, значения неотрицательны.
ALTER TABLE "VenueStatsHourly" ADD CONSTRAINT "VenueStatsHourly_hour_range" CHECK ("hour" BETWEEN 0 AND 23 AND "openPeak" >= 0 AND "checkins" >= 0);
