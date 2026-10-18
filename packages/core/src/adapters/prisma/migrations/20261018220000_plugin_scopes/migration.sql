-- A ship holds core scopes and plugin scopes, each <namespace>:<action> (decision 0046):
-- a scope of a core namespace is one of the known core scopes; any other namespace is a plugin's.
CREATE FUNCTION "ships_scopes_are_known"("scopes" TEXT[]) RETURNS BOOLEAN IMMUTABLE LANGUAGE SQL AS $$
  SELECT "scopes" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM unnest("scopes") AS "scope"
    WHERE NOT (
      "scope" = ANY(ARRAY['messages:send', 'messages:receive', 'messages:force', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'scopes:declare', 'scopes:grant']::TEXT[])
      OR ("scope" ~ '^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$' AND split_part("scope", ':', 1) <> ALL(ARRAY['messages', 'fleet', 'crew', 'labels', 'scopes']::TEXT[]))
    )
  )
$$;

ALTER TABLE "ships" DROP CONSTRAINT "ships_scopes_known";
ALTER TABLE "ships" ADD CONSTRAINT "ships_scopes_known" CHECK ("ships_scopes_are_known"("scopes"));
