-- fleet:crew (decision 0002): a trierarch's scope, the fifth known one. argo
-- holds every scope, so each fleet's argo gets it too.
ALTER TABLE "ships" DROP CONSTRAINT "ships_scopes_known";
ALTER TABLE "ships" ADD CONSTRAINT "ships_scopes_known" CHECK (
  "scopes" IS NOT NULL AND "scopes" <@ ARRAY['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'fleet:crew']::TEXT[]
);

UPDATE "ships" SET "scopes" = array_append("scopes", 'fleet:crew') WHERE "kind" = 'operator' AND NOT ('fleet:crew' = ANY("scopes"));
