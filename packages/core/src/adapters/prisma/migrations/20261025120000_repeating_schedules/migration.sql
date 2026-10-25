-- Repeating schedules (decision 0062): every a fixed duration or a cron in its zone, from a start to an end
-- or a count of sends; what a missed send time does and its grace; a missed send time as a last outcome.
-- The new enum values are read through ::text below: Postgres refuses a value added in the same transaction.
ALTER TYPE "schedule_timing_kind" ADD VALUE 'every';
ALTER TYPE "schedule_timing_kind" ADD VALUE 'cron';
ALTER TYPE "schedule_outcome_kind" ADD VALUE 'missed';

-- CreateEnum
CREATE TYPE "missed_strategy" AS ENUM ('each', 'once', 'skip');

ALTER TABLE "schedules" ALTER COLUMN "once_at" DROP NOT NULL,
  ADD COLUMN "every" TEXT,
  ADD COLUMN "cron" TEXT,
  ADD COLUMN "time_zone" TEXT,
  ADD COLUMN "start" TIMESTAMPTZ(3),
  ADD COLUMN "end" TIMESTAMPTZ(3),
  ADD COLUMN "count" INTEGER,
  ADD COLUMN "on_missed" "missed_strategy" NOT NULL DEFAULT 'each',
  ADD COLUMN "grace" TEXT NOT NULL DEFAULT 'PT5M';

-- Every schedule states its own; the defaults only filled the ones already there.
ALTER TABLE "schedules" ALTER COLUMN "on_missed" DROP DEFAULT, ALTER COLUMN "grace" DROP DEFAULT;

-- The timing whole: once an instant; every a duration, cron an expression and its zone, each with optional bounds.
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_one_timing" CHECK (
  ("timing_kind"::text = 'once' AND "once_at" IS NOT NULL AND "every" IS NULL AND "cron" IS NULL AND "time_zone" IS NULL
    AND "start" IS NULL AND "end" IS NULL AND "count" IS NULL)
  OR ("timing_kind"::text = 'every' AND "once_at" IS NULL AND "every" IS NOT NULL AND "cron" IS NULL AND "time_zone" IS NULL)
  OR ("timing_kind"::text = 'cron' AND "once_at" IS NULL AND "every" IS NULL AND "cron" IS NOT NULL AND "time_zone" IS NOT NULL)
);
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_repeat_bounds" CHECK (("count" IS NULL OR "count" >= 1) AND ("start" IS NULL OR "end" IS NULL OR "end" > "start"));

-- The last outcome: the message it stored, the code it was refused with, or a send time missed, each with its send time and when.
ALTER TABLE "schedules" DROP CONSTRAINT "schedules_last_outcome";
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_last_outcome" CHECK (
  ("last_outcome_kind" IS NULL AND "last_message_id" IS NULL AND "last_refusal_code" IS NULL AND "last_send_time" IS NULL AND "last_outcome_at" IS NULL)
  OR ("last_outcome_kind"::text = 'sent' AND "last_message_id" IS NOT NULL AND "last_refusal_code" IS NULL AND "last_send_time" IS NOT NULL AND "last_outcome_at" IS NOT NULL)
  OR ("last_outcome_kind"::text = 'refused' AND "last_message_id" IS NULL AND "last_refusal_code" IS NOT NULL AND "last_send_time" IS NOT NULL AND "last_outcome_at" IS NOT NULL)
  OR ("last_outcome_kind"::text = 'missed' AND "last_message_id" IS NULL AND "last_refusal_code" IS NULL AND "last_send_time" IS NOT NULL AND "last_outcome_at" IS NOT NULL)
);
