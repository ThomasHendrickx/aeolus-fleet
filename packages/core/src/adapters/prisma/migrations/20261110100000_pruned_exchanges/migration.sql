-- How far pruning went in each exchange (docs/design/exchange-history): per pair of ships, the lower id
-- first, the send time of the newest message of their exchange that pruning removed. Written only by the
-- pruning batch. Nothing is marked here: what was pruned before it is not known per exchange (H4).
CREATE TABLE "pruned_exchanges" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "other_ship_id" TEXT NOT NULL,
    "pruned_up_to" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pruned_exchanges_pkey" PRIMARY KEY ("fleet_id", "ship_id", "other_ship_id")
);

-- Backs the foreign key to the other ship, as every foreign key is backed; the read uses the primary key alone.
CREATE INDEX "pruned_exchanges_fleet_id_other_ship_id_idx" ON "pruned_exchanges"("fleet_id", "other_ship_id");

ALTER TABLE "pruned_exchanges" ADD CONSTRAINT "pruned_exchanges_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pruned_exchanges" ADD CONSTRAINT "pruned_exchanges_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pruned_exchanges" ADD CONSTRAINT "pruned_exchanges_fleet_id_other_ship_id_fkey" FOREIGN KEY ("fleet_id", "other_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
