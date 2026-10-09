-- fleet:network (decision 0034): setting the fleet's network rules. argo
-- holds every scope, so each fleet's argo gets it too.
ALTER TABLE "ships" DROP CONSTRAINT "ships_scopes_known";
ALTER TABLE "ships" ADD CONSTRAINT "ships_scopes_known" CHECK (
  "scopes" IS NOT NULL AND "scopes" <@ ARRAY['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network']::TEXT[]
);

UPDATE "ships" SET "scopes" = array_append("scopes", 'fleet:network') WHERE "kind" = 'operator' AND NOT ('fleet:network' = ANY("scopes"));
