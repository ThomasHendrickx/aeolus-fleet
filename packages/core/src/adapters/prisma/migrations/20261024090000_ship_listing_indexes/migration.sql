-- The fleet snapshot pages its active ships by keyset (decision 4 of the
-- performance design): in the default order, argo first and then by name,
-- and sorted by ship, a page reads its own ships from where the cursor
-- points, never every ship before it. Each key is the listing's order term
-- as the statement writes it, in its collation.
CREATE INDEX "ships_listing_idx" ON "ships"("fleet_id", (kind <> 'operator'::ship_kind), (lower("name")) COLLATE "C", "id" COLLATE "C")
  WHERE "retired_at" IS NULL;
CREATE INDEX "ships_name_listing_idx" ON "ships"("fleet_id", (lower("name")) COLLATE "C", "id" COLLATE "C")
  WHERE "retired_at" IS NULL;
-- The overview's Type filter reads the distinct types of the active ships
-- from this index alone.
CREATE INDEX "ships_type_listing_idx" ON "ships"("fleet_id", "type")
  WHERE "retired_at" IS NULL;
