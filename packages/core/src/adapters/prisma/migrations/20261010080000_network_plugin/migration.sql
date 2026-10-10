-- The fleet's networking plugin (decision 0035): its ship and what it
-- declared, kept with the network settings, all three set or none; and on a
-- refusal, what it declared when it refused while the plugin was not
-- responding.
ALTER TABLE "network_settings"
    ADD COLUMN "plugin_ship_id" TEXT,
    ADD COLUMN "plugin_while_unavailable" TEXT,
    ADD COLUMN "plugin_not_responding_after_seconds" INTEGER,
    ADD CONSTRAINT "network_settings_plugin_whole" CHECK (
        ("plugin_ship_id" IS NULL) = ("plugin_while_unavailable" IS NULL)
        AND ("plugin_ship_id" IS NULL) = ("plugin_not_responding_after_seconds" IS NULL)
    ),
    ADD CONSTRAINT "network_settings_plugin_while_unavailable" CHECK (
        "plugin_while_unavailable" IN ('block-all', 'open-all', 'keep-latest')
    );

ALTER TABLE "reach_refusals"
    ADD COLUMN "while_plugin_unavailable" TEXT,
    ADD CONSTRAINT "reach_refusals_while_plugin_unavailable" CHECK (
        "while_plugin_unavailable" IN ('block-all', 'keep-latest')
    );
