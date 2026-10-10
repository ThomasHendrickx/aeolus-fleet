-- The network rules each ship declared on the labels it owns (decision 0037):
-- one row per declaring ship, none while it declares none.
-- CreateTable
CREATE TABLE "declared_network_rules" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "rules" JSONB NOT NULL,

    CONSTRAINT "declared_network_rules_pkey" PRIMARY KEY ("fleet_id","ship_id")
);

-- AddForeignKey
ALTER TABLE "declared_network_rules" ADD CONSTRAINT "declared_network_rules_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declared_network_rules" ADD CONSTRAINT "declared_network_rules_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
