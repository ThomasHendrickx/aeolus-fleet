-- A refusal keeps each ship's owner then (decision 0034). Refusals from
-- before owners knew none, so each of their ships gets none.
UPDATE "reach_refusals"
SET
  "sender" = "sender" || '{"owner": null}'::jsonb,
  "recipient" = CASE "recipient"->>'kind'
    WHEN 'ship' THEN jsonb_set("recipient", '{ship}', ("recipient"->'ship') || '{"owner": null}'::jsonb)
    ELSE jsonb_set(
      "recipient",
      '{ships}',
      COALESCE((SELECT jsonb_agg(ship || '{"owner": null}'::jsonb ORDER BY position) FROM jsonb_array_elements("recipient"->'ships') WITH ORDINALITY AS refused(ship, position)), '[]'::jsonb)
    )
  END
WHERE NOT "sender" ? 'owner';
