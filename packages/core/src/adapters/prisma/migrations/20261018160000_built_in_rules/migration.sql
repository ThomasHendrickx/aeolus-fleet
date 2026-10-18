-- The built-in rules that can be off (decision 0034): the viewer reading and
-- open per verb, on at fleet create.
ALTER TABLE "network_settings"
  ADD COLUMN IF NOT EXISTS "built_in_viewer_read" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "built_in_open_send" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "built_in_open_read" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "built_in_open_manage" BOOLEAN NOT NULL DEFAULT true;

-- A fleet whose networking plugin set rules was checked against them alone, so
-- open is off for it; every other fleet reached every ship, so open stays on.
UPDATE "network_settings"
SET "built_in_open_send" = false, "built_in_open_read" = false, "built_in_open_manage" = false
WHERE "plugin_ship_id" IS NOT NULL AND "rules" IS NOT NULL;
