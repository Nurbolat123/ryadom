
-- CreateEnum
CREATE TYPE "NoticeKind" AS ENUM ('sympathy_anonymous');

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "kind" "NoticeKind" NOT NULL DEFAULT 'sympathy_anonymous',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notice_userId_createdAt_idx" ON "Notice"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Сообщение чата не пустое (до 2000 символов — по типу колонки).
ALTER TABLE "Message" ADD CONSTRAINT "Message_body_not_empty" CHECK (char_length(btrim("body")) >= 1);
