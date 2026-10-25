-- Scheduled messages (decision 0062): a ship's schedule, its send input as given, its timing and refusal
-- strategy, its state, next send time and attempt, and its last outcome; a message names the schedule it was sent for.

-- CreateEnum
CREATE TYPE "schedule_state" AS ENUM ('active', 'paused', 'ended', 'cancelled');

-- CreateEnum
CREATE TYPE "schedule_timing_kind" AS ENUM ('once');

-- CreateEnum
CREATE TYPE "refusal_strategy" AS ENUM ('skip', 'retry', 'pause');

-- CreateEnum
CREATE TYPE "schedule_outcome_kind" AS ENUM ('sent', 'refused');

-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "selector_kind" "selector_kind" NOT NULL,
    "selector_ship_id" TEXT,
    "selector_ship_name" TEXT,
    "selector_type" TEXT,
    "payload" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "model" TEXT,
    "in_reply_to_message_id" TEXT,
    "is_forced" BOOLEAN NOT NULL,
    "timing_kind" "schedule_timing_kind" NOT NULL,
    "once_at" TIMESTAMPTZ(3) NOT NULL,
    "on_refused" "refusal_strategy" NOT NULL,
    "retry_window" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "state" "schedule_state" NOT NULL,
    "next_send_time" TIMESTAMPTZ(3),
    "next_attempt_at" TIMESTAMPTZ(3),
    "last_outcome_kind" "schedule_outcome_kind",
    "last_message_id" TEXT,
    "last_refusal_code" TEXT,
    "last_send_time" TIMESTAMPTZ(3),
    "last_outcome_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedules_fleet_id_ship_id_id_idx" ON "schedules"("fleet_id", "ship_id", "id");

-- CreateIndex
CREATE INDEX "schedules_due_idx" ON "schedules"("fleet_id", "next_attempt_at", "id") WHERE (state = 'active'::schedule_state);

-- CreateIndex
CREATE INDEX "schedules_fleet_id_selector_ship_id_idx" ON "schedules"("fleet_id", "selector_ship_id");

-- CreateIndex
CREATE INDEX "schedules_fleet_id_in_reply_to_message_id_idx" ON "schedules"("fleet_id", "in_reply_to_message_id");

-- CreateIndex
CREATE INDEX "schedules_fleet_id_last_message_id_idx" ON "schedules"("fleet_id", "last_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_fleet_id_id_key" ON "schedules"("fleet_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_fleet_id_ship_id_idempotency_key_key" ON "schedules"("fleet_id", "ship_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "messages_fleet_id_schedule_id_idx" ON "messages"("fleet_id", "schedule_id");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_fleet_id_schedule_id_fkey" FOREIGN KEY ("fleet_id", "schedule_id") REFERENCES "schedules"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_fleet_id_selector_ship_id_fkey" FOREIGN KEY ("fleet_id", "selector_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_fleet_id_in_reply_to_message_id_fkey" FOREIGN KEY ("fleet_id", "in_reply_to_message_id") REFERENCES "messages"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_fleet_id_last_message_id_fkey" FOREIGN KEY ("fleet_id", "last_message_id") REFERENCES "messages"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The selector as the creator gave it: a ship by id, a ship by name, or a type; never a meeting.
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_one_selector" CHECK (
  ("selector_kind" = 'ship' AND "selector_type" IS NULL AND (("selector_ship_id" IS NULL) <> ("selector_ship_name" IS NULL)))
  OR ("selector_kind" = 'type' AND "selector_type" IS NOT NULL AND "selector_ship_id" IS NULL AND "selector_ship_name" IS NULL)
);

-- The last outcome: the message it stored, or the code it was refused with, each with its send time and when.
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_last_outcome" CHECK (
  ("last_outcome_kind" IS NULL AND "last_message_id" IS NULL AND "last_refusal_code" IS NULL AND "last_send_time" IS NULL AND "last_outcome_at" IS NULL)
  OR ("last_outcome_kind" = 'sent' AND "last_message_id" IS NOT NULL AND "last_refusal_code" IS NULL AND "last_send_time" IS NOT NULL AND "last_outcome_at" IS NOT NULL)
  OR ("last_outcome_kind" = 'refused' AND "last_message_id" IS NULL AND "last_refusal_code" IS NOT NULL AND "last_send_time" IS NOT NULL AND "last_outcome_at" IS NOT NULL)
);

-- Only an active schedule has a next attempt; an ended or cancelled one has no next send time.
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_next_attempt_when_active" CHECK (("state" = 'active') = ("next_attempt_at" IS NOT NULL));
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_no_send_time_when_closed" CHECK ("state" IN ('active', 'paused') OR "next_send_time" IS NULL);
