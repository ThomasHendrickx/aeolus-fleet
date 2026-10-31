-- A ship's record reads the deliveries of its type it claimed newest first by id (Bridge, CC12).
-- Partial: a foreign key check on deliveries never matches its predicate, so a bulk delete never picks it.
CREATE INDEX "deliveries_record_fleet_id_claimed_by_ship_id_id_idx" ON "deliveries"("fleet_id", "claimed_by_ship_id", "id")
  WHERE recipient_type IS NOT NULL;
