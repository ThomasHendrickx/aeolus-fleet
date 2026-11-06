-- The rollup of the list of exchanges (docs/design/exchange-read, E4, E5): per person ship and each ship it
-- exchanged with, the newest message between them and how many of the other ship's deliveries to it are not
-- yet acknowledged. Kept in the transactions that make and change deliveries; filled once here from them.
CREATE TABLE "exchanges" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "other_ship_id" TEXT NOT NULL,
    "newest_message_id" TEXT NOT NULL,
    "unacknowledged" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "exchanges_pkey" PRIMARY KEY ("fleet_id", "ship_id", "other_ship_id")
);

-- The list pages a ship's rows newest first; the others back the foreign keys.
CREATE INDEX "exchanges_fleet_id_ship_id_newest_message_id_idx" ON "exchanges"("fleet_id", "ship_id", "newest_message_id");
CREATE INDEX "exchanges_fleet_id_other_ship_id_idx" ON "exchanges"("fleet_id", "other_ship_id");
CREATE INDEX "exchanges_fleet_id_newest_message_id_idx" ON "exchanges"("fleet_id", "newest_message_id");

ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_fleet_id_other_ship_id_fkey" FOREIGN KEY ("fleet_id", "other_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_fleet_id_newest_message_id_fkey" FOREIGN KEY ("fleet_id", "newest_message_id") REFERENCES "messages"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "exchanges" ("fleet_id", "ship_id", "other_ship_id", "newest_message_id", "unacknowledged")
SELECT x."fleet_id", x."ship_id", x."other_ship_id", max(x."message_id"),
       (count(*) FILTER (WHERE x."is_to_ship" AND x."state" IN ('pending', 'received', 'handed')))::int
FROM (
  SELECT d."fleet_id", d."reached_ship_id" AS "ship_id", d."sender_ship_id" AS "other_ship_id", d."message_id", d."state", true AS "is_to_ship"
  FROM "deliveries" d WHERE d."is_in_exchange" AND d."reached_ship_id" IS NOT NULL
  UNION ALL
  SELECT d."fleet_id", d."sender_ship_id", d."reached_ship_id", d."message_id", d."state", false
  FROM "deliveries" d WHERE d."is_in_exchange" AND d."reached_ship_id" IS NOT NULL
) x
JOIN "ships" s ON s."fleet_id" = x."fleet_id" AND s."id" = x."ship_id" AND s."kind" = 'person'
GROUP BY x."fleet_id", x."ship_id", x."other_ship_id";
