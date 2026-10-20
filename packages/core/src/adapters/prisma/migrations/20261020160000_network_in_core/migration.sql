-- Network rules live in core (decision 0034): the networking plugin goes.
-- A fleet's own rules are a list, or NULL while none are applied: all-to-all,
-- open on. A fleet whose open was on for send had no rules in force beside
-- the built-in ones, so it keeps none; any other keeps its list.
UPDATE "network_settings" SET "rules" = NULL WHERE "built_in_open_send";
ALTER TABLE "network_settings" ALTER COLUMN "rules" DROP NOT NULL, ALTER COLUMN "rules" DROP DEFAULT;

ALTER TABLE "network_settings"
  DROP CONSTRAINT IF EXISTS "network_settings_plugin_whole",
  DROP COLUMN "built_in_open_send",
  DROP COLUMN "built_in_open_read",
  DROP COLUMN "built_in_open_manage",
  DROP COLUMN "plugin_ship_id",
  DROP COLUMN "plugin_while_unavailable",
  DROP COLUMN "plugin_not_responding_after_seconds",
  DROP COLUMN "plugin_registered_at";

ALTER TABLE "reach_refusals" DROP COLUMN "while_plugin_unavailable";

-- The draft of a fleet's own rules: one a fleet at most, never in force.
CREATE TABLE "network_rules_drafts" (
    "fleet_id" TEXT NOT NULL,
    "rules" JSONB,
    "saved_at" TIMESTAMPTZ(3) NOT NULL,
    "saved_against_version" INTEGER NOT NULL,

    CONSTRAINT "network_rules_drafts_pkey" PRIMARY KEY ("fleet_id")
);

ALTER TABLE "network_rules_drafts" ADD CONSTRAINT "network_rules_drafts_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
