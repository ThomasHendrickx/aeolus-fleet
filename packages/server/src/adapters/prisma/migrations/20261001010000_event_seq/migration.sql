-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "last_event_seq" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "seq" BIGINT;


-- Written by hand from here on: numbering the events already written.

-- Events written before this migration have committed, so any order is a
-- valid stream; time, then id, is the closest to the order they happened in.
-- Events are append-only; this one-time numbering is the single exception, so
-- the guard is off for this statement alone.
ALTER TABLE "events" DISABLE TRIGGER "events_append_only";

UPDATE "events" AS e
SET "seq" = numbered."seq"
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "fleet_id" ORDER BY "occurred_at", "id") AS "seq"
  FROM "events"
) AS numbered
WHERE e."id" = numbered."id";

ALTER TABLE "events" ENABLE TRIGGER "events_append_only";

UPDATE "fleets" AS f
SET "last_event_seq" = counted."last_seq"
FROM (SELECT "fleet_id", MAX("seq") AS "last_seq" FROM "events" GROUP BY "fleet_id") AS counted
WHERE f."id" = counted."fleet_id";

ALTER TABLE "events" ALTER COLUMN "seq" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "events_fleet_id_seq_key" ON "events"("fleet_id", "seq");
