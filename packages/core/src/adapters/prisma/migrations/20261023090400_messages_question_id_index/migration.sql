-- A question's withdrawals and replacements to argo are found by the question
-- id they name (decision 0038), read from the payload by this expression,
-- which never fails on a payload that is not JSON. Only messages whose
-- content type is one of the question family are indexed.
CREATE INDEX "messages_question_id_idx" ON "messages"("fleet_id", (substring("payload" from '"questionId"\s*:\s*"([^"]*)"'))) WHERE lower("content_type") LIKE 'application/vnd.aeolus.question-%';
