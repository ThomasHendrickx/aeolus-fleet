-- labels:define and labels:assign (decision 0031): defining labels and
-- assigning them. argo holds every scope, so each fleet's argo gets them too.
ALTER TABLE "ships" DROP CONSTRAINT "ships_scopes_known";
ALTER TABLE "ships" ADD CONSTRAINT "ships_scopes_known" CHECK (
  "scopes" IS NOT NULL AND "scopes" <@ ARRAY['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign']::TEXT[]
);

UPDATE "ships" SET "scopes" = array_append("scopes", 'labels:define') WHERE "kind" = 'operator' AND NOT ('labels:define' = ANY("scopes"));
UPDATE "ships" SET "scopes" = array_append("scopes", 'labels:assign') WHERE "kind" = 'operator' AND NOT ('labels:assign' = ANY("scopes"));
