-- Rule matches for the person ship reads (#1741): derived from the rules and
-- carried values, rewritten in the same transaction as every change of
-- either. A row exists only while some bit of to_rules is set.
CREATE TABLE "ship_rule_matches" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "verb" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "to_rules" BIT VARYING NOT NULL,
    "to_rules_every_actor" BIT VARYING NOT NULL,

    CONSTRAINT "ship_rule_matches_pkey" PRIMARY KEY ("fleet_id","ship_id","verb","source")
);

ALTER TABLE "ship_rule_matches" ADD CONSTRAINT "ship_rule_matches_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ship_rule_matches" ADD CONSTRAINT "ship_rule_matches_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A ship declaration's empty pair grants its verb to every actor for every
-- candidate. The authoritative JSON keeps these indexes; the reads' fixed
-- probes repeat their predicates exactly, so absence is an index proof.
CREATE INDEX "declared_network_rules_person_read_universal_idx"
  ON "declared_network_rules" ("fleet_id")
  WHERE jsonb_path_exists(rules, '$[*] ? (@.verb == "read" && @.from.size() == 0 && @.to.size() == 0)');
CREATE INDEX "declared_network_rules_person_send_universal_idx"
  ON "declared_network_rules" ("fleet_id")
  WHERE jsonb_path_exists(rules, '$[*] ? (@.verb == "send" && @.from.size() == 0 && @.to.size() == 0)');
