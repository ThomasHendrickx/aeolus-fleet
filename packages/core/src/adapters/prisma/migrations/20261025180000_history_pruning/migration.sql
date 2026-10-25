-- Pruning finished history (decision 0066). A message's in-reply-to and
-- resend-of stay as written, with no foreign key, so a kept reply may name a
-- message that is no longer kept.
ALTER TABLE "messages" DROP CONSTRAINT "messages_fleet_id_in_reply_to_message_id_fkey";

ALTER TABLE "messages" DROP CONSTRAINT "messages_fleet_id_resend_of_message_id_fkey";

-- When a fleet's last pruning pass ran, and from when it keeps its finished history.
ALTER TABLE "fleets" ADD COLUMN     "kept_from" TIMESTAMPTZ(3),
ADD COLUMN     "pruned_at" TIMESTAMPTZ(3);

-- The pruning pass finds the mic and participant events of ended meetings.
CREATE INDEX "events_meeting_parts_idx" ON "events"("fleet_id", "seq") WHERE (type = ANY (ARRAY['ParticipantAdded'::text, 'ParticipantLeft'::text, 'ParticipantRejoined'::text, 'ParticipantRevoked'::text, 'MicRequested'::text, 'MicRequestWithdrawn'::text, 'MicGiven'::text, 'MicReleased'::text, 'MicTaken'::text, 'MicPatternSet'::text]));

-- Events stay append-only. Two exceptions: deleting a whole fleet (decision
-- 0020) and a pruning batch (decision 0066). Each names the fleet in its own
-- transaction-local setting, and only that fleet's events may go.
CREATE OR REPLACE FUNCTION "events_reject_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (OLD."fleet_id" = current_setting('aeolus.deleting_fleet', true) OR OLD."fleet_id" = current_setting('aeolus.pruning_fleet', true)) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'events are append-only: % is not allowed', TG_OP;
END;
$$;
