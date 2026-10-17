-- messages:force (decision 0040): a forced send, whose delivery comes first.
-- argo holds every scope, so each fleet's argo gets it too.
ALTER TABLE "ships" DROP CONSTRAINT "ships_scopes_known";
ALTER TABLE "ships" ADD CONSTRAINT "ships_scopes_known" CHECK (
  "scopes" IS NOT NULL AND "scopes" <@ ARRAY['messages:send', 'messages:receive', 'messages:force', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network']::TEXT[]
);

UPDATE "ships" SET "scopes" = array_append("scopes", 'messages:force') WHERE "kind" = 'operator' AND NOT ('messages:force' = ANY("scopes"));
