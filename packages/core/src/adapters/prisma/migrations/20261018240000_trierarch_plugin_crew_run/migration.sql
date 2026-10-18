-- The trierarch plugin gives each machine's trierarch ship crew:run at commission, and a commission grants
-- only what its commissioner holds (decision 0046): every active trierarch-plugin ship gets crew:run.
-- Every state change writes its event: each ship it changes gets ScopesChanged, by the system, taking the
-- next number of its fleet's stream. Its id is an evt_ id as common/src/ids makes them: the time in
-- milliseconds, then 80 random bits, in lowercase Crockford base32.
DO $$
DECLARE
  alphabet CONSTANT text := '0123456789abcdefghjkmnpqrstvwxyz';
  changed record;
  at timestamptz;
  millis bigint;
  body text;
  next_seq bigint;
BEGIN
  FOR changed IN
    UPDATE "ships" SET "scopes" = array_append("scopes", 'crew:run')
    WHERE "type" = 'trierarch-plugin' AND "retired_at" IS NULL AND NOT ('crew:run' = ANY("scopes"))
    RETURNING "fleet_id", "id"
  LOOP
    at := clock_timestamp();
    millis := floor(extract(epoch FROM at) * 1000)::bigint;
    body := '';
    FOR position IN REVERSE 9..0 LOOP
      body := body || substr(alphabet, ((millis >> (position * 5)) & 31)::integer + 1, 1);
    END LOOP;
    FOR position IN 1..16 LOOP
      body := body || substr(alphabet, floor(random() * 32)::integer + 1, 1);
    END LOOP;

    UPDATE "fleets" SET "last_event_seq" = "last_event_seq" + 1 WHERE "id" = changed."fleet_id"
      RETURNING "last_event_seq" INTO next_seq;
    INSERT INTO "events" ("id", "fleet_id", "type", "occurred_at", "ship_id", "details", "seq")
    VALUES (
      'evt_' || body,
      changed."fleet_id",
      'ScopesChanged',
      at,
      changed."id",
      jsonb_build_object('added', 'crew:run', 'removed', ''),
      next_seq
    );
  END LOOP;
END;
$$;
