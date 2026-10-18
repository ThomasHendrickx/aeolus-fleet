-- A fleet's rules are a list beside the built-in rules (decision 0034): no
-- rules was all-to-all, which open, on for every such fleet, now says.
UPDATE "network_settings" SET "rules" = '[]'::jsonb WHERE "rules" IS NULL;

ALTER TABLE "network_settings" ALTER COLUMN "rules" SET DEFAULT '[]'::jsonb, ALTER COLUMN "rules" SET NOT NULL;
