-- The question uuid a question or a replacement asks, and the one an answer
-- names, read at send (#1632): so a retiring ship's open questions are
-- selected in the query, in a sealed fleet too.
ALTER TABLE "messages"
ADD COLUMN "asked_question_id" TEXT,
ADD COLUMN "answered_question_id" TEXT;

-- CreateIndex
CREATE INDEX "messages_fleet_id_sender_ship_id_id_asked_idx" ON "messages"("fleet_id", "sender_ship_id", "id") WHERE ("asked_question_id" IS NOT NULL);

-- Unfilled plain questions remain readable through the same sender/id range.
CREATE INDEX "messages_unfilled_questions_idx" ON "messages" ("fleet_id", "sender_ship_id", "id")
WHERE asked_question_id IS NULL AND payload IS NOT NULL
  AND lower(btrim(split_part(content_type, ';', 1))) IN ('application/vnd.aeolus.question+json', 'application/vnd.aeolus.question-replacement+json');

-- One durable cursor per fleet, committed with each batch after core listens.
CREATE TABLE message_metadata_backfills (
  fleet_id TEXT PRIMARY KEY REFERENCES fleets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  after_message_id TEXT NOT NULL DEFAULT '',
  is_complete BOOLEAN NOT NULL DEFAULT false
);
