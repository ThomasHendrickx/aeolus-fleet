-- The installation counts a fleet's messages of the last 7 days through an
-- index on fleet and time, not by reading every message it stored (#1126).
CREATE INDEX "messages_fleet_id_created_at_idx" ON "messages"("fleet_id", "created_at");
