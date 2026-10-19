-- Every event names its actor (decision 0057): a ship, an account by its id
-- only with the ship it came through, the installation, or the system.
CREATE TYPE "event_actor_kind" AS ENUM ('ship', 'account', 'installation', 'system');

ALTER TABLE "events" ADD COLUMN "actor_kind" "event_actor_kind",
ADD COLUMN "actor_account_id" TEXT,
ADD COLUMN "actor_through_ship_id" TEXT;

-- Naming the actor of the events already written, a ship or the system, is
-- the one exception to append-only events, so the guard is off for this
-- statement alone.
ALTER TABLE "events" DISABLE TRIGGER "events_append_only";

UPDATE "events" SET "actor_kind" = CASE WHEN "actor_ship_id" IS NULL THEN 'system'::"event_actor_kind" ELSE 'ship'::"event_actor_kind" END;

ALTER TABLE "events" ENABLE TRIGGER "events_append_only";

-- An event that names no actor is the system's, as every migration that writes events writes them.
ALTER TABLE "events" ALTER COLUMN "actor_kind" SET NOT NULL, ALTER COLUMN "actor_kind" SET DEFAULT 'system';

-- A ship actor has its ship, an account its id and maybe the ship it came through, the others neither.
ALTER TABLE "events" ADD CONSTRAINT "events_actor_named" CHECK (
  ("actor_ship_id" IS NOT NULL) = ("actor_kind" = 'ship')
  AND ("actor_account_id" IS NOT NULL) = ("actor_kind" = 'account')
  AND ("actor_through_ship_id" IS NULL OR "actor_kind" = 'account')
);

-- Led by the ship, not the fleet: almost every row has none, and an index led
-- by the fleet would tempt the planner off (fleet_id, occurred_at).
CREATE INDEX "events_actor_through_ship_id_fleet_id_idx" ON "events"("actor_through_ship_id", "fleet_id");

ALTER TABLE "events" ADD CONSTRAINT "events_fleet_id_actor_through_ship_id_fkey" FOREIGN KEY ("fleet_id", "actor_through_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
