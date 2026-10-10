-- Every state change writes its event: the rules the migration before this
-- one cleared get theirs. A fleet it cleared has no plugin and no rules, yet
-- the change at its current version is a NetworkRulesSet that gave rules.
-- Each such fleet moves to the next version with NetworkRulesSet for none,
-- by the system, taking the next number of the fleet's stream. Its id is an
-- evt_ id as common/src/ids makes them: the time in milliseconds, then 80
-- random bits, in lowercase Crockford base32.
DO $$
DECLARE
  alphabet CONSTANT text := '0123456789abcdefghjkmnpqrstvwxyz';
  cleared record;
  at timestamptz;
  millis bigint;
  body text;
  next_version integer;
  next_seq bigint;
BEGIN
  FOR cleared IN
    SELECT settings."fleet_id", settings."version"
    FROM "network_settings" settings
    WHERE settings."plugin_ship_id" IS NULL
      AND settings."rules" IS NULL
      AND EXISTS (
        SELECT 1 FROM "events" event
        WHERE event."fleet_id" = settings."fleet_id"
          AND event."type" = 'NetworkRulesSet'
          AND event."details" -> 'version' = to_jsonb(settings."version")
          AND event."details" -> 'rules' <> 'null'::jsonb
      )
    ORDER BY settings."fleet_id"
  LOOP
    at := clock_timestamp();
    millis := floor(extract(epoch FROM at) * 1000)::bigint;
    body := '';
    FOR position IN REVERSE 9..0 LOOP
      body := body || substr(alphabet, ((millis >> (position * 5)) & 31)::integer + 1, 1);
    END LOOP;
    FOR position IN 1..16 LOOP
      body := body || substr(alphabet, floor(random() * 32)::integer + 1, 1);
    END LOOP;

    next_version := cleared."version" + 1;
    UPDATE "network_settings" SET "version" = next_version WHERE "fleet_id" = cleared."fleet_id";
    UPDATE "fleets" SET "last_event_seq" = "last_event_seq" + 1 WHERE "id" = cleared."fleet_id"
      RETURNING "last_event_seq" INTO next_seq;
    INSERT INTO "events" ("id", "fleet_id", "type", "occurred_at", "details", "seq")
    VALUES (
      'evt_' || body,
      cleared."fleet_id",
      'NetworkRulesSet',
      at,
      jsonb_build_object('version', next_version, 'rules', NULL),
      next_seq
    );
  END LOOP;
END;
$$;
