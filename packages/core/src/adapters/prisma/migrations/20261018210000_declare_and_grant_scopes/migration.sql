-- scopes:declare and scopes:grant (decision 0046): taking up a plugin namespace, and granting on a live ship.
-- argo holds every scope, so each fleet's argo gets both too.
ALTER TABLE "ships" DROP CONSTRAINT "ships_scopes_known";
ALTER TABLE "ships" ADD CONSTRAINT "ships_scopes_known" CHECK (
  "scopes" IS NOT NULL AND "scopes" <@ ARRAY['messages:send', 'messages:receive', 'messages:force', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'scopes:declare', 'scopes:grant']::TEXT[]
);

UPDATE "ships" SET "scopes" = array_cat("scopes", ARRAY['scopes:declare', 'scopes:grant']::TEXT[]) WHERE "kind" = 'operator' AND NOT ('scopes:declare' = ANY("scopes"));
