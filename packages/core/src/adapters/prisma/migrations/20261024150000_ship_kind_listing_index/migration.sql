-- fleet.list's shipKind filter (performance S6): the few active ships of a kind, such as argo and the person ships, without reading every ship.
CREATE INDEX "ships_kind_listing_idx" ON "ships"("fleet_id", "kind") WHERE ("retired_at" IS NULL);
