-- Rules exist only through a registered networking plugin (decision 0035):
-- rules argo set before then go, all-to-all. The version stays, as it names
-- the settings past refusals were checked against.
UPDATE "network_settings" SET "rules" = NULL WHERE "plugin_ship_id" IS NULL;
