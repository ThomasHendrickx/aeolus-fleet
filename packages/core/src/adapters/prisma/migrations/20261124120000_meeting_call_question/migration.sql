ALTER TABLE meeting_calls ADD COLUMN question TEXT;

-- Old sealed or pruned payloads cannot be recovered by a SQL migration.
-- Guard malformed historical payloads before casting them to JSON.
UPDATE meeting_calls AS call
SET question = CASE
  WHEN pg_input_is_valid(message.payload, 'jsonb') THEN
    CASE WHEN jsonb_typeof(message.payload::jsonb -> 'question') = 'string'
      THEN message.payload::jsonb ->> 'question' END
  END
FROM messages AS message
WHERE message.fleet_id = call.fleet_id AND message.id = call.id;
