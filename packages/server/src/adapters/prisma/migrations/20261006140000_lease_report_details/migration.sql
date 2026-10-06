-- AlterTable
ALTER TABLE "leases" ADD COLUMN     "report_details" JSONB,
ADD COLUMN     "report_details_version" INTEGER NOT NULL DEFAULT 0;
