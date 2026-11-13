-- The owner argo named at its last commission, preselected for its next one from the console (decision 0045):
-- read newest first through the commissioner's OwnerSet events alone.
CREATE INDEX "events_owner_set_idx" ON "events"("fleet_id", "actor_ship_id", "seq")
  WHERE type = 'OwnerSet';
