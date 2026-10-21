-- A plugin ship is kind plugin and reads every ship by its kind (decision 0050): connection and kind are one fact.
-- The plugin ships of a running fleet become kind plugin: every active ship with a plugin connection, and every
-- active ship the console connects a plugin as, known by its name and type together. Every state change writes its
-- event: each ship it connects that had no connection gets PluginConnected, by the system, at the next number of
-- its fleet's stream, with an evt_ id as common/src/ids makes them (the time in milliseconds, then 80 random bits,
-- in lowercase Crockford base32). A ship with a connection has its PluginConnected already.
DO $$
DECLARE
  alphabet CONSTANT text := '0123456789abcdefghjkmnpqrstvwxyz';
  changed record;
  at timestamptz;
  millis bigint;
  body text;
  next_seq bigint;
BEGIN
  FOR changed IN
    UPDATE "ships" SET "kind" = 'plugin'
    WHERE "retired_at" IS NULL
      AND (
        ("fleet_id", "id") IN (SELECT "fleet_id", "ship_id" FROM "plugin_connections")
        OR ("name" = "type" AND "type" IN ('squadrons', 'trierarch-plugin', 'gateway'))
      )
    RETURNING "fleet_id", "id",
      ("fleet_id", "id") IN (SELECT "fleet_id", "ship_id" FROM "plugin_connections") AS "was_connected"
  LOOP
    CONTINUE WHEN changed."was_connected";
    at := clock_timestamp();
    millis := floor(extract(epoch FROM at) * 1000)::bigint;
    body := '';
    FOR position IN REVERSE 9..0 LOOP
      body := body || substr(alphabet, ((millis >> (position * 5)) & 31)::integer + 1, 1);
    END LOOP;
    FOR position IN 1..16 LOOP
      body := body || substr(alphabet, floor(random() * 32)::integer + 1, 1);
    END LOOP;

    UPDATE "fleets" SET "last_event_seq" = "last_event_seq" + 1 WHERE "id" = changed."fleet_id"
      RETURNING "last_event_seq" INTO next_seq;
    INSERT INTO "events" ("id", "fleet_id", "type", "occurred_at", "ship_id", "details", "seq")
    VALUES ('evt_' || body, changed."fleet_id", 'PluginConnected', at, changed."id", '{}'::jsonb, next_seq);
  END LOOP;
END;
$$;

-- DropTable
DROP TABLE "plugin_connections";
