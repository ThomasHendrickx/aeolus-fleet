-- The installation's health figures scan a fleet's open deliveries by state (decision 0041).
-- Partial: a foreign key check on deliveries never matches its predicate, so a bulk delete never picks it.
CREATE INDEX "deliveries_open_fleet_id_state_created_at_idx" ON "deliveries"("fleet_id", "state", "created_at")
  WHERE state IN ('pending', 'received', 'handed', 'undeliverable', 'notHandled');
