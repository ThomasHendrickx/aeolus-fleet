-- A message's deliveries are read a page at a time by id (decision 0065): one per ship of a send to a label.

-- DropIndex
DROP INDEX "deliveries_fleet_id_message_id_idx";

-- CreateIndex
CREATE INDEX "deliveries_fleet_id_message_id_id_idx" ON "deliveries"("fleet_id", "message_id", "id");
