-- fleet:alert, raising and clearing alerts on the ships its ship reads, joins the core scopes in the namespace fleet (decisions 0046, 0071).
CREATE OR REPLACE FUNCTION "ships_scopes_are_known"("scopes" TEXT[]) RETURNS BOOLEAN IMMUTABLE LANGUAGE SQL AS $$
  SELECT "scopes" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM unnest("scopes") AS "scope"
    WHERE NOT (
      "scope" = ANY(ARRAY['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'fleet:person', 'fleet:owner', 'fleet:explain', 'fleet:connect', 'labels:any', 'fleet:verify', 'scopes:declare', 'scopes:grant', 'scopes:define', 'meetings:open', 'fleet:keys', 'fleet:alert']::TEXT[])
      OR ("scope" ~ '^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$' AND split_part("scope", ':', 1) <> ALL(ARRAY['messages', 'fleet', 'crew', 'labels', 'scopes', 'meetings']::TEXT[]))
    )
  )
$$;

-- argo holds every scope: every argo gets fleet:alert, its scopes kept in catalogue order, a plugin's own after
-- them. Every state change writes its event: each argo it changes gets ScopesChanged, by the system, taking
-- the next number of its fleet's stream. Its id is an evt_ id as common/src/ids makes them: the time in
-- milliseconds, then 80 random bits, in lowercase Crockford base32.
DO $$
DECLARE
  alphabet CONSTANT text := '0123456789abcdefghjkmnpqrstvwxyz';
  catalogue CONSTANT text[] := ARRAY['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'fleet:person', 'fleet:owner', 'fleet:explain', 'fleet:connect', 'labels:any', 'fleet:verify', 'scopes:declare', 'scopes:grant', 'scopes:define', 'meetings:open', 'fleet:keys', 'fleet:alert'];
  jobs CONSTANT text[] := ARRAY['fleet:alert'];
  changed record;
  at timestamptz;
  millis bigint;
  body text;
  next_seq bigint;
BEGIN
  FOR changed IN
    WITH "before" AS (
      SELECT "id", "scopes" FROM "ships" WHERE "kind" = 'operator' AND NOT ("scopes" @> jobs) FOR UPDATE
    )
    UPDATE "ships" SET "scopes" = (
      SELECT array_agg("scope" ORDER BY coalesce(array_position(catalogue, "scope"), cardinality(catalogue) + 1), "place")
      FROM unnest("ships"."scopes" || ARRAY(SELECT "job" FROM unnest(jobs) AS "job" WHERE NOT ("job" = ANY("ships"."scopes")))) WITH ORDINALITY AS u("scope", "place")
    )
    FROM "before"
    WHERE "ships"."id" = "before"."id"
    RETURNING "ships"."fleet_id", "ships"."id",
      array_to_string(ARRAY(SELECT "job" FROM unnest(jobs) AS "job" WHERE NOT ("job" = ANY("before"."scopes"))), ' ') AS "added"
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
      jsonb_build_object('added', changed."added", 'removed', ''),
      next_seq
    );
  END LOOP;
END;
$$;
