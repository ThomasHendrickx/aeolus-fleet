-- The health trend replay reads a fleet's events since a time (decision 0042), not its whole history (#865).
CREATE INDEX "events_fleet_id_occurred_at_idx" ON "events"("fleet_id", "occurred_at");
