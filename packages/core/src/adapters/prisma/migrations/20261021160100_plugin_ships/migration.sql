-- A plugin ship is kind plugin and reads every ship by its kind (decision 0050): connection and kind are one fact.
-- The plugin ships of a running fleet become kind plugin: every active ship with a plugin connection, and every
-- active ship the console connects a plugin as, known by its name and type together.
UPDATE "ships" SET "kind" = 'plugin'
WHERE "retired_at" IS NULL
  AND (
    ("fleet_id", "id") IN (SELECT "fleet_id", "ship_id" FROM "plugin_connections")
    OR ("name" = "type" AND "type" IN ('squadrons', 'trierarch-plugin', 'gateway'))
  );

-- DropTable
DROP TABLE "plugin_connections";
