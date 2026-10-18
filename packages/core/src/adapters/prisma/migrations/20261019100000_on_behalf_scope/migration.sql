-- fleet:on-behalf joins the core scopes (decision 0046): a ship reads on behalf of a named ship with it (decision 0034).
CREATE OR REPLACE FUNCTION "ships_scopes_are_known"("scopes" TEXT[]) RETURNS BOOLEAN IMMUTABLE LANGUAGE SQL AS $$
  SELECT "scopes" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM unnest("scopes") AS "scope"
    WHERE NOT (
      "scope" = ANY(ARRAY['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'scopes:declare', 'scopes:grant']::TEXT[])
      OR ("scope" ~ '^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$' AND split_part("scope", ':', 1) <> ALL(ARRAY['messages', 'fleet', 'crew', 'labels', 'scopes']::TEXT[]))
    )
  )
$$;

-- argo holds every scope, and squadrons reads on behalf of a person's ship (decision 0017): every argo and every
-- active squadrons ship gets fleet:on-behalf, its scopes kept in catalogue order, a plugin's own after them.
-- Every state change writes its event: each ship it changes gets
-- ScopesChanged, by the system, taking the next number of its fleet's stream. Its id is an evt_ id as
-- common/src/ids makes them: the time in milliseconds, then 80 random bits, in lowercase Crockford base32.
DO $$
DECLARE
  alphabet CONSTANT text := '0123456789abcdefghjkmnpqrstvwxyz';
  catalogue CONSTANT text[] := ARRAY['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'scopes:declare', 'scopes:grant'];
  changed record;
  at timestamptz;
  millis bigint;
  body text;
  next_seq bigint;
BEGIN
  FOR changed IN
    UPDATE "ships" SET "scopes" = (
      SELECT array_agg("scope" ORDER BY coalesce(array_position(catalogue, "scope"), cardinality(catalogue) + 1), "place")
      FROM unnest(array_append("ships"."scopes", 'fleet:on-behalf')) WITH ORDINALITY AS u("scope", "place")
    )
    WHERE ("kind" = 'operator' OR "type" = 'squadrons') AND "retired_at" IS NULL AND NOT ('fleet:on-behalf' = ANY("scopes"))
    RETURNING "fleet_id", "id"
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

    UPDATE "fleets" SET "last_event_seq" = "last_event_seq" + 1 WHERE "id" = changed."fleet_id"
      RETURNING "last_event_seq" INTO next_seq;
    INSERT INTO "events" ("id", "fleet_id", "type", "occurred_at", "ship_id", "details", "seq")
    VALUES (
      'evt_' || body,
      changed."fleet_id",
      'ScopesChanged',
      at,
      changed."id",
      jsonb_build_object('added', 'fleet:on-behalf', 'removed', ''),
      next_seq
    );
  END LOOP;
END;
$$;
