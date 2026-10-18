-- When the fleet's networking plugin first registered (decision 0035), set
-- with its ship and declaration, all four or none. A plugin registered before
-- this column takes the time of its first NetworkPluginRegistered event since
-- the fleet's latest NetworkPluginUnregistered (a retirement writes one too).
ALTER TABLE "network_settings" ADD COLUMN "plugin_registered_at" TIMESTAMPTZ(3);

UPDATE "network_settings" AS s
SET "plugin_registered_at" = COALESCE(
    (SELECT min(e."occurred_at") FROM "events" e
     WHERE e."fleet_id" = s."fleet_id" AND e."type" = 'NetworkPluginRegistered' AND e."ship_id" = s."plugin_ship_id"
       AND e."occurred_at" > COALESCE(
           (SELECT max(u."occurred_at") FROM "events" u WHERE u."fleet_id" = s."fleet_id" AND u."type" = 'NetworkPluginUnregistered'),
           '-infinity')),
    now())
WHERE s."plugin_ship_id" IS NOT NULL;

ALTER TABLE "network_settings"
    DROP CONSTRAINT "network_settings_plugin_whole",
    ADD CONSTRAINT "network_settings_plugin_whole" CHECK (
        ("plugin_ship_id" IS NULL) = ("plugin_while_unavailable" IS NULL)
        AND ("plugin_ship_id" IS NULL) = ("plugin_not_responding_after_seconds" IS NULL)
        AND ("plugin_ship_id" IS NULL) = ("plugin_registered_at" IS NULL)
    );
