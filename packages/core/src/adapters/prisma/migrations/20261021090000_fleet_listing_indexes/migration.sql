-- The fleet listing finds who crewed each ship, the actor of its last StartingPromptIssued (#1027).
-- Without this it walked every event of the fleet once per ship.
CREATE INDEX "events_starting_prompt_issued_idx" ON "events"("fleet_id", "ship_id", "seq")
  WHERE type = 'StartingPromptIssued';

-- The fleet listing finds the last ping to each ship (#1027); a ping is always addressed to its ship.
-- Without this it read every delivery to the ship.
CREATE INDEX "messages_pings_idx" ON "messages"("fleet_id", "selector_ship_id", "created_at", "id")
  WHERE content_type = 'application/vnd.aeolus.ping';
