-- The scope catalogue (decision 0046): fleet:commission and messages:resend are core scopes.
CREATE OR REPLACE FUNCTION "ships_scopes_are_known"("scopes" TEXT[]) RETURNS BOOLEAN IMMUTABLE LANGUAGE SQL AS $$
  SELECT "scopes" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM unnest("scopes") AS "scope"
    WHERE NOT (
      "scope" = ANY(ARRAY['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'scopes:declare', 'scopes:grant']::TEXT[])
      OR ("scope" ~ '^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$' AND split_part("scope", ':', 1) <> ALL(ARRAY['messages', 'fleet', 'crew', 'labels', 'scopes']::TEXT[]))
    )
  )
$$;

-- Each holder keeps what it did within the new bounds: every active ship holding fleet:manage also gets
-- fleet:commission and messages:resend, and each active plugin ship holds exactly its set, losing what the
-- set leaves out. A plugin's ship is known by its name and type together, as the console connects it: types
-- are not reserved, so another ship of that type keeps what it holds. Scopes stay in catalogue order, a plugin's own after them. Every ship it
-- changes gets one ScopesChanged, by the system, naming what it added and took away, at the next number of
-- its fleet's stream, with an evt_ id as common/src/ids makes them (the time in milliseconds, then 80 random
-- bits, in lowercase Crockford base32).
DO $$
DECLARE
  alphabet CONSTANT text := '0123456789abcdefghjkmnpqrstvwxyz';
  catalogue CONSTANT text[] := ARRAY['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'scopes:declare', 'scopes:grant'];
  ship record;
  wanted text[];
  added text;
  removed text;
  at timestamptz;
  millis bigint;
  body text;
  next_seq bigint;
BEGIN
  FOR ship IN
    SELECT "id", "fleet_id", "name", "type", "scopes" FROM "ships"
    WHERE "retired_at" IS NULL AND ("name" = "type" AND "type" IN ('squadrons', 'trierarch-plugin') OR 'fleet:manage' = ANY("scopes"))
    ORDER BY "fleet_id", "id"
    FOR UPDATE
  LOOP
    wanted := CASE ship."name" || '/' || ship."type"
      WHEN 'squadrons/squadrons' THEN ARRAY['messages:send', 'messages:receive', 'fleet:read', 'fleet:commission', 'fleet:manage', 'labels:define', 'labels:assign', 'scopes:declare']
      WHEN 'trierarch-plugin/trierarch-plugin' THEN ARRAY['messages:send', 'messages:receive', 'fleet:read', 'fleet:commission', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign']
      ELSE ship."scopes" || ARRAY['fleet:commission', 'messages:resend']
    END;
    SELECT array_agg("scope" ORDER BY coalesce(array_position(catalogue, "scope"), cardinality(catalogue) + 1), "first_at") INTO wanted
    FROM (SELECT "scope", min("place") AS "first_at" FROM unnest(wanted) WITH ORDINALITY AS u("scope", "place") GROUP BY "scope") AS once;
    added := coalesce((SELECT string_agg("scope", ' ' ORDER BY "place") FROM unnest(wanted) WITH ORDINALITY AS u("scope", "place") WHERE "scope" <> ALL(ship."scopes")), '');
    removed := coalesce((SELECT string_agg("scope", ' ' ORDER BY "place") FROM unnest(ship."scopes") WITH ORDINALITY AS u("scope", "place") WHERE "scope" <> ALL(wanted)), '');
    CONTINUE WHEN added = '' AND removed = '';

    UPDATE "ships" SET "scopes" = wanted WHERE "id" = ship."id";

    at := clock_timestamp();
    millis := floor(extract(epoch FROM at) * 1000)::bigint;
    body := '';
    FOR position IN REVERSE 9..0 LOOP
      body := body || substr(alphabet, ((millis >> (position * 5)) & 31)::integer + 1, 1);
    END LOOP;
    FOR position IN 1..16 LOOP
      body := body || substr(alphabet, floor(random() * 32)::integer + 1, 1);
    END LOOP;

    UPDATE "fleets" SET "last_event_seq" = "last_event_seq" + 1 WHERE "id" = ship."fleet_id"
      RETURNING "last_event_seq" INTO next_seq;
    INSERT INTO "events" ("id", "fleet_id", "type", "occurred_at", "ship_id", "details", "seq")
    VALUES ('evt_' || body, ship."fleet_id", 'ScopesChanged', at, ship."id", jsonb_build_object('added', added, 'removed', removed), next_seq);
  END LOOP;
END;
$$;
