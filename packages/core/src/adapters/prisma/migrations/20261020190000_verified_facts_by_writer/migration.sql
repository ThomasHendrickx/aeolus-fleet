-- A retiring writer finds its verified facts about every ship (decision 0059).
-- CreateIndex
CREATE INDEX "verified_facts_fleet_id_writer_kind_writer_idx" ON "verified_facts"("fleet_id", "writer_kind", "writer");
