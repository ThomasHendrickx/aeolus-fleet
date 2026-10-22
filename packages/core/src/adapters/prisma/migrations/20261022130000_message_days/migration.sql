-- The messages per fleet and UTC day (performance design, decision 1): a row
-- per fleet and day with its messages and their payloads' UTF-8 bytes, added to
-- by each send, so storage and the daily counts no longer scan the messages.
-- Every message stored before this migration is counted into it once.
CREATE TABLE "message_days" (
    "fleet_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "messages" INTEGER NOT NULL,
    "payload_bytes" BIGINT NOT NULL,

    CONSTRAINT "message_days_pkey" PRIMARY KEY ("fleet_id", "day")
);

ALTER TABLE "message_days" ADD CONSTRAINT "message_days_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A payload's UTF-8 bytes, whatever the database encoding.
INSERT INTO "message_days" ("fleet_id", "day", "messages", "payload_bytes")
SELECT "fleet_id", ("created_at" AT TIME ZONE 'UTC')::date, count(*), coalesce(sum(octet_length(convert_to("payload", 'UTF8'))), 0)
FROM "messages"
GROUP BY 1, 2;
