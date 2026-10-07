-- Язык Telegram-бота в чате персонала заведения.

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "staffLocale" "Locale" NOT NULL DEFAULT 'ru';

