-- The installation's health figures scan a fleet's deliveries by state (#304).
CREATE INDEX "deliveries_fleet_id_state_created_at_idx" ON "deliveries"("fleet_id", "state", "created_at");
