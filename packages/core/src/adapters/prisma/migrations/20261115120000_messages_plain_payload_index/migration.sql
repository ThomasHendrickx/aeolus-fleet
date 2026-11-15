-- The plain messages of a sealing fleet, oldest first: whether one is left is
-- read from it alone, never across the sealed ones (decision 0068, #1854).
CREATE INDEX "messages_plain_payload_idx" ON "messages"("fleet_id", "created_at", "id")
  WHERE payload IS NOT NULL;
