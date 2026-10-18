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
