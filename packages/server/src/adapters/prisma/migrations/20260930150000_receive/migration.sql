-- No delivery was claimed before this migration: nothing received one yet. So
-- every existing delivery is pending, or was returned to pending, and names no
-- claim; the check below holds for it.

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "claimed_by_lease_id" TEXT;

-- CreateIndex
CREATE INDEX "deliveries_fleet_id_claimed_by_lease_id_state_idx" ON "deliveries"("fleet_id", "claimed_by_lease_id", "state");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_fleet_id_claimed_by_lease_id_fkey" FOREIGN KEY ("fleet_id", "claimed_by_lease_id") REFERENCES "leases"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Written by hand from here on: rules Prisma does not model.

-- A claim names both the ship and the lease of the crew that claimed, or
-- neither. A delivery in flight or acknowledged names its claim; a pending one
-- names none.
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_claim" CHECK (
  num_nonnulls("claimed_by_ship_id", "claimed_by_lease_id") IN (0, 2)
  AND ("state" NOT IN ('delivered', 'acknowledged') OR "claimed_by_ship_id" IS NOT NULL)
  AND ("state" <> 'pending' OR "claimed_by_ship_id" IS NULL)
);
