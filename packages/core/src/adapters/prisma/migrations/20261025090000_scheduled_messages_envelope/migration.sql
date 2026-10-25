-- Scheduled messages (decision 0062): a message names the schedule it was sent for and that send time,
-- both or neither; a live send has neither.
ALTER TABLE "messages" ADD COLUMN "schedule_id" TEXT, ADD COLUMN "send_time" TIMESTAMPTZ(3);

ALTER TABLE "messages" ADD CONSTRAINT "messages_schedule_with_send_time" CHECK (("schedule_id" IS NULL) = ("send_time" IS NULL));
