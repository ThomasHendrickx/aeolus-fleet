-- Sealed fleets (decision 0068, B11): whether the company key answered the fleet's last unwrap, and since when.

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN "key_unavailable_reason" TEXT,
ADD COLUMN "key_availability_since" TIMESTAMPTZ(3);

-- A sealed fleet's key was available when it turned sealing on.
UPDATE "fleets" f SET "key_availability_since" = COALESCE(
  (SELECT min(e."occurred_at") FROM "events" e WHERE e."fleet_id" = f."id" AND e."type" = 'FleetSealingTurnedOn'),
  now()
) WHERE f."sealing_state" IS NOT NULL;

-- A sealed fleet knows since when its key is available or not, and why not; a fleet that is not sealed neither.
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_key_availability_whole" CHECK (
  ("sealing_state" IS NULL AND "key_availability_since" IS NULL AND "key_unavailable_reason" IS NULL)
  OR ("sealing_state" IS NOT NULL AND "key_availability_since" IS NOT NULL
    AND ("key_unavailable_reason" IS NULL OR "key_unavailable_reason" IN ('accessDenied', 'disabled', 'notFound', 'unreachable')))
);
