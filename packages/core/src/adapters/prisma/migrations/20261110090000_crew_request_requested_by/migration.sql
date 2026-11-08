-- The ship that made a crew request last (docs/design enabled models, R2): where the trierarch plugin tells why it waits.
-- Null for a request made before it was recorded.
ALTER TABLE "crew_requests" ADD COLUMN "requested_by_ship_id" TEXT;

CREATE INDEX "crew_requests_fleet_id_requested_by_ship_id_idx" ON "crew_requests"("fleet_id", "requested_by_ship_id");

ALTER TABLE "crew_requests" ADD CONSTRAINT "crew_requests_fleet_id_requested_by_ship_id_fkey" FOREIGN KEY ("fleet_id", "requested_by_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
