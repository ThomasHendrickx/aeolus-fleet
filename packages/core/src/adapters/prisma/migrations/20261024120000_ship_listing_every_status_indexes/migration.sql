-- The fleet snapshot with the retired ships asked pages every ship by
-- keyset, in the default order and sorted by ship, as the active-only
-- listing indexes do for the active ones.
CREATE INDEX "ships_listing_every_status_idx" ON "ships"("fleet_id", (kind <> 'operator'::ship_kind), (lower("name")) COLLATE "C", "id" COLLATE "C");
CREATE INDEX "ships_name_listing_every_status_idx" ON "ships"("fleet_id", (lower("name")) COLLATE "C", "id" COLLATE "C");
