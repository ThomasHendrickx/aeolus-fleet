-- The question uuid a question or a replacement asks, and the one an answer
-- names, read at send (#1632): so a retiring ship's open questions are
-- selected in the query, in a sealed fleet too.
ALTER TABLE "messages"
ADD COLUMN "asked_question_id" TEXT,
ADD COLUMN "answered_question_id" TEXT;

-- Plain payloads only: a sealed one does not open here.
UPDATE "messages" SET "asked_question_id" = substring("payload" from '"id"\s*:\s*"([^"]*)"')
WHERE "payload" IS NOT NULL
  AND lower(btrim(split_part("content_type", ';', 1))) IN ('application/vnd.aeolus.question+json', 'application/vnd.aeolus.question-replacement+json');

UPDATE "messages" SET "answered_question_id" = substring("payload" from '"questionId"\s*:\s*"([^"]*)"')
WHERE "payload" IS NOT NULL
  AND lower(btrim(split_part("content_type", ';', 1))) = 'application/vnd.aeolus.answer+json';

-- CreateIndex
CREATE INDEX "messages_fleet_id_sender_ship_id_id_asked_idx" ON "messages"("fleet_id", "sender_ship_id", "id") WHERE ("asked_question_id" IS NOT NULL);
