-- A ship's inbox pages newest first by delivery id, through an index that
-- reads its deliveries in that order instead of every one it was sent.
CREATE INDEX "deliveries_fleet_id_recipient_ship_id_id_idx" ON "deliveries"("fleet_id", "recipient_ship_id", "id");
