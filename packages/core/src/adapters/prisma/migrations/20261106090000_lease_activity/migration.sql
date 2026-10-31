-- A lease's activity, as its assigned trierarch writes it (docs/design/monitoring, 4.3).

-- CreateEnum
CREATE TYPE "activity_kind" AS ENUM ('text', 'tool', 'result', 'error');

-- AlterTable
ALTER TABLE "leases" ADD COLUMN     "activity_at" TIMESTAMPTZ(3),
ADD COLUMN     "activity_kind" "activity_kind",
ADD COLUMN     "activity_tool" TEXT,
ADD COLUMN     "activity_reported_at" TIMESTAMPTZ(3),
ADD COLUMN     "activity_interval_seconds" INTEGER;
