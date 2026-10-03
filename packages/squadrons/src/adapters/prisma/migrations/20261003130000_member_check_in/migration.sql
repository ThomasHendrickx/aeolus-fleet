-- AlterTable
ALTER TABLE "members" ADD COLUMN     "check_in_at" TIMESTAMPTZ(3),
ADD COLUMN     "check_in_model" TEXT;
