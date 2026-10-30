-- A report's task, step and when it last changed (decision 0028).

-- AlterTable
ALTER TABLE "leases" ADD COLUMN     "report_changed_at" TIMESTAMPTZ(3),
ADD COLUMN     "report_step_at" INTEGER,
ADD COLUMN     "report_step_of" INTEGER,
ADD COLUMN     "report_task" JSONB;

-- A report made before changes were told apart last changed when it was last reported.
UPDATE "leases" SET "report_changed_at" = "reported_at" WHERE "reported_at" IS NOT NULL;
