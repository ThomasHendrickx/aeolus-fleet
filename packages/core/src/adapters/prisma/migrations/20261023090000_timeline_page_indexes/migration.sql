-- A ship's timeline pages through the events naming it and the events it
-- caused by their place in the stream: each index ends with seq, so a page
-- reads its rows in order instead of every event of the ship.
DROP INDEX "events_fleet_id_actor_ship_id_idx";
DROP INDEX "events_fleet_id_ship_id_idx";
CREATE INDEX "events_fleet_id_actor_ship_id_seq_idx" ON "events"("fleet_id", "actor_ship_id", "seq");
CREATE INDEX "events_fleet_id_ship_id_seq_idx" ON "events"("fleet_id", "ship_id", "seq");
