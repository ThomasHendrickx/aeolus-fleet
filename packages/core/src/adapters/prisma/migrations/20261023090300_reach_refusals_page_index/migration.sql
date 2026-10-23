-- The reach refusals page newest first by id, through an index that reads
-- them in that order.
DROP INDEX "reach_refusals_fleet_id_at_idx";
CREATE INDEX "reach_refusals_fleet_id_id_idx" ON "reach_refusals"("fleet_id", "id");
