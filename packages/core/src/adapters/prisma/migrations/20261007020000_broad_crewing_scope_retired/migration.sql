-- The broad crewing scope goes (decision 0029): crew:assign and crew:run
-- replace it. Every ship that held it, argo included, loses it; nothing is
-- kept for compatibility (decision 0013).
UPDATE "ships" SET "scopes" = array_remove("scopes", 'fleet:crew');
ALTER TABLE "ships" DROP CONSTRAINT "ships_scopes_known";
ALTER TABLE "ships" ADD CONSTRAINT "ships_scopes_known" CHECK (
  "scopes" IS NOT NULL AND "scopes" <@ ARRAY['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run']::TEXT[]
);
