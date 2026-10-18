-- A plugin argo connected (decision 0034): its ship reads every ship of the fleet, whatever the rules, until a
-- release or a retire of the ship ends it.
-- CreateTable
CREATE TABLE "plugin_connections" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "connected_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plugin_connections_pkey" PRIMARY KEY ("fleet_id","ship_id")
);

-- AddForeignKey
ALTER TABLE "plugin_connections" ADD CONSTRAINT "plugin_connections_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_connections" ADD CONSTRAINT "plugin_connections_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The plugins argo connected before: every active ship the console connects a plugin as, known by its name and type
-- together (squadrons, the trierarch plugin, the networking plugin), is connected now. Each gets PluginConnected, by
-- the system, at the next number of its fleet's stream, with an evt_ id as common/src/ids makes them (the time in
-- milliseconds, then 80 random bits, in lowercase Crockford base32).
DO $$
DECLARE
  alphabet CONSTANT text := '0123456789abcdefghjkmnpqrstvwxyz';
  plugin record;
  at timestamptz;
  millis bigint;
  body text;
  next_seq bigint;
BEGIN
  FOR plugin IN
    SELECT "id", "fleet_id" FROM "ships"
    WHERE "retired_at" IS NULL AND "name" = "type" AND "type" IN ('squadrons', 'trierarch-plugin', 'networking-plugin')
    ORDER BY "fleet_id", "id"
  LOOP
    at := clock_timestamp();
    INSERT INTO "plugin_connections" ("fleet_id", "ship_id", "connected_at") VALUES (plugin."fleet_id", plugin."id", at);

    millis := floor(extract(epoch FROM at) * 1000)::bigint;
    body := '';
    FOR position IN REVERSE 9..0 LOOP
      body := body || substr(alphabet, ((millis >> (position * 5)) & 31)::integer + 1, 1);
    END LOOP;
    FOR position IN 1..16 LOOP
      body := body || substr(alphabet, floor(random() * 32)::integer + 1, 1);
    END LOOP;

    UPDATE "fleets" SET "last_event_seq" = "last_event_seq" + 1 WHERE "id" = plugin."fleet_id"
      RETURNING "last_event_seq" INTO next_seq;
    INSERT INTO "events" ("id", "fleet_id", "type", "occurred_at", "ship_id", "details", "seq")
    VALUES ('evt_' || body, plugin."fleet_id", 'PluginConnected', at, plugin."id", '{}'::jsonb, next_seq);
  END LOOP;
END;
$$;
