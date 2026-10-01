-- CreateEnum
CREATE TYPE "theme" AS ENUM ('light', 'dark', 'system');

-- AlterTable
ALTER TABLE "operators" ADD COLUMN     "theme" "theme" NOT NULL DEFAULT 'system';

-- AlterTable
ALTER TABLE "console_sessions" ADD COLUMN     "device" TEXT NOT NULL DEFAULT 'Unknown device';
