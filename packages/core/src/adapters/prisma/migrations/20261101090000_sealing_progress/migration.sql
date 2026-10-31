-- Sealed fleets (decision 0068, B5): since when the fleet reads its sealing state, and how far the sealing pass is.

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN "sealing_state_since" TIMESTAMPTZ(3),
ADD COLUMN "payloads_to_seal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "payloads_sealed" INTEGER NOT NULL DEFAULT 0;

-- A sealed fleet reads sealed since the sealing pass left no payload plain, or since it turned sealing on.
UPDATE "fleets" f SET "sealing_state_since" = COALESCE(
  CASE WHEN f."sealing_state" = 'sealed' THEN (SELECT max(e."occurred_at") FROM "events" e WHERE e."fleet_id" = f."id" AND e."type" = 'FleetPayloadsSealed') END,
  (SELECT min(e."occurred_at") FROM "events" e WHERE e."fleet_id" = f."id" AND e."type" = 'FleetSealingTurnedOn'),
  now()
) WHERE f."sealing_state" IS NOT NULL;

-- A sealed fleet knows since when it reads its state; a fleet that is not sealed does not.
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_sealing_state_since_whole" CHECK (("sealing_state" IS NULL) = ("sealing_state_since" IS NULL));
