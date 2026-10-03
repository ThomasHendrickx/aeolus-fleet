-- AlterTable
ALTER TABLE "members" ADD COLUMN     "stand_down_message_id" TEXT,
ADD COLUMN     "stood_down_at" TIMESTAMPTZ(3),
ADD COLUMN     "retired_at" TIMESTAMPTZ(3);
