-- Seen up to here (docs/design/exchange-read, E6) finds the deliveries of its type a ship claimed that are still in flight,
-- not every one it ever claimed. Partial: a foreign key check on deliveries never matches its predicate, so a bulk delete never picks it.
CREATE INDEX "deliveries_in_flight_claimed_idx" ON "deliveries"("fleet_id", "claimed_by_ship_id", "id")
  WHERE recipient_type IS NOT NULL AND state IN ('received', 'handed');
