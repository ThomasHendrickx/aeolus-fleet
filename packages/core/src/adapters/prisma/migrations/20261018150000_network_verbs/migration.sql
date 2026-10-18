-- Every rule names its verb (decision 0034). Rules allowed only sends before,
-- so every rule a fleet holds and every rule a ship declared becomes a send rule.
UPDATE "network_settings"
SET "rules" = (SELECT jsonb_agg(jsonb_build_object('verb', 'send') || rule ORDER BY position) FROM jsonb_array_elements("rules") WITH ORDINALITY AS kept(rule, position))
WHERE jsonb_typeof("rules") = 'array' AND jsonb_array_length("rules") > 0;

UPDATE "declared_network_rules"
SET "rules" = (SELECT jsonb_agg(jsonb_build_object('verb', 'send') || rule ORDER BY position) FROM jsonb_array_elements("rules") WITH ORDINALITY AS kept(rule, position))
WHERE jsonb_array_length("rules") > 0;
