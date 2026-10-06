-- CreateEnum
CREATE TYPE "report_state" AS ENUM ('working', 'blocked', 'idle');

-- AlterTable
ALTER TABLE "leases" ADD COLUMN     "report_state" "report_state",
ADD COLUMN     "report_note" TEXT,
ADD COLUMN     "reported_at" TIMESTAMPTZ(3);
