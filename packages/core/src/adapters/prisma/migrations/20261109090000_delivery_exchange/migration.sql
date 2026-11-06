-- The exchange read (docs/design/exchange-read, E1 and E3): each delivery carries its message's sender,
-- whether its message is in an exchange (no meeting, no ping), and the ship it reached: its recipient,
-- or the ship of its type that claimed it. The reached ship follows the claim, so it is generated, never written.
ALTER TABLE "deliveries" ADD COLUMN "sender_ship_id" TEXT;
ALTER TABLE "deliveries" ADD COLUMN "is_in_exchange" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deliveries" ADD COLUMN "reached_ship_id" TEXT GENERATED ALWAYS AS (COALESCE("recipient_ship_id", "claimed_by_ship_id")) STORED;

UPDATE "deliveries" d
SET "sender_ship_id" = m."sender_ship_id",
    "is_in_exchange" = (m."meeting_id" IS NULL AND lower(btrim(split_part(m."content_type", ';', 1))) <> 'application/vnd.aeolus.ping')
FROM "messages" m
WHERE m."fleet_id" = d."fleet_id" AND m."id" = d."message_id";

ALTER TABLE "deliveries" ALTER COLUMN "sender_ship_id" SET NOT NULL;

-- One exchange page is two range scans of this index, one per direction.
-- Partial: a foreign key check on deliveries never matches its predicate, so a bulk delete never picks it.
CREATE INDEX "deliveries_exchange_idx" ON "deliveries"("fleet_id", "reached_ship_id", "sender_ship_id", "id")
  WHERE is_in_exchange;
