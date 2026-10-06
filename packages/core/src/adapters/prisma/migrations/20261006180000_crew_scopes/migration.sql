-- crew:assign and crew:run (decision 0029): the trierarch plugin's and a
-- trierarch's scopes. argo holds every scope, so each fleet's argo gets them too.
ALTER TABLE "ships" DROP CONSTRAINT "ships_scopes_known";
ALTER TABLE "ships" ADD CONSTRAINT "ships_scopes_known" CHECK (
  "scopes" IS NOT NULL AND "scopes" <@ ARRAY['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'fleet:crew', 'crew:assign', 'crew:run']::TEXT[]
);

UPDATE "ships" SET "scopes" = array_append("scopes", 'crew:assign') WHERE "kind" = 'operator' AND NOT ('crew:assign' = ANY("scopes"));
UPDATE "ships" SET "scopes" = array_append("scopes", 'crew:run') WHERE "kind" = 'operator' AND NOT ('crew:run' = ANY("scopes"));
