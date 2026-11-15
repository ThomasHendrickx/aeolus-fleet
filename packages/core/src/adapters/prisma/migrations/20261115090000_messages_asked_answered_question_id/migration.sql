-- The question uuid a question or a replacement asks, and the one an answer
-- names, read at send (#1632): so a retiring ship's open questions are
-- selected in the query, in a sealed fleet too.
ALTER TABLE "messages"
ADD COLUMN "asked_question_id" TEXT,
ADD COLUMN "answered_question_id" TEXT;

-- CreateIndex
CREATE INDEX "messages_fleet_id_sender_ship_id_id_asked_idx" ON "messages"("fleet_id", "sender_ship_id", "id") WHERE ("asked_question_id" IS NOT NULL);

-- One cursor per fleet for the fill after start (docs/architecture.md,
-- Backfills): the last message it visited by id and the last exchange by key,
-- committed with each batch. Core builds the fill's indexes after start too.
CREATE TABLE message_metadata_backfills (
  fleet_id TEXT PRIMARY KEY REFERENCES fleets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  after_message_id TEXT,
  after_ship_id TEXT,
  after_other_ship_id TEXT,
  is_complete BOOLEAN NOT NULL DEFAULT false
);
