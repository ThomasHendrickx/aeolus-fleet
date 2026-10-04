-- Events stay append-only. The one exception is deleting a whole fleet
-- (decision 0020): its transaction names the fleet in the transaction-local
-- setting aeolus.deleting_fleet, and only that fleet's events may go.
CREATE OR REPLACE FUNCTION "events_reject_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."fleet_id" = current_setting('aeolus.deleting_fleet', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'events are append-only: % is not allowed', TG_OP;
END;
$$;
