-- The network rules the installation declares on the labels it owns, such as group=# to group=# (decisions 0037, 0052):
-- one row per fleet while it declares any, apart from the ships' declared rules, as it is no ship.
CREATE TABLE "installation_declared_network_rules" (
    "fleet_id" TEXT NOT NULL,
    "rules" JSONB NOT NULL,

    CONSTRAINT "installation_declared_network_rules_pkey" PRIMARY KEY ("fleet_id")
);

ALTER TABLE "installation_declared_network_rules" ADD CONSTRAINT "installation_declared_network_rules_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
