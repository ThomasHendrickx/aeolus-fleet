-- The 10 and 60 minute clocks (decision 0040): a delivery argo was told is
-- overdue on a pushed lease, once per lease and delivery.
CREATE TYPE "overdue_clock" AS ENUM ('notConfirmed', 'idle', 'busy');

CREATE TABLE "overdue_deliveries" (
    "fleet_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "state" "delivery_state" NOT NULL,
    "clock" "overdue_clock" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "told_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "overdue_deliveries_pkey" PRIMARY KEY ("fleet_id","lease_id","delivery_id")
);

CREATE INDEX "overdue_deliveries_fleet_id_delivery_id_idx" ON "overdue_deliveries"("fleet_id", "delivery_id");

CREATE INDEX "overdue_deliveries_fleet_id_ship_id_idx" ON "overdue_deliveries"("fleet_id", "ship_id");

ALTER TABLE "overdue_deliveries" ADD CONSTRAINT "overdue_deliveries_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "overdue_deliveries" ADD CONSTRAINT "overdue_deliveries_fleet_id_lease_id_fkey" FOREIGN KEY ("fleet_id", "lease_id") REFERENCES "leases"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "overdue_deliveries" ADD CONSTRAINT "overdue_deliveries_fleet_id_delivery_id_fkey" FOREIGN KEY ("fleet_id", "delivery_id") REFERENCES "deliveries"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "overdue_deliveries" ADD CONSTRAINT "overdue_deliveries_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
