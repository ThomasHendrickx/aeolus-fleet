-- Removed ships (decision 0070): the pruning pass turns a ship retired
-- before its cutoff into a remnant, stamped removed_at. Nothing lists a
-- remnant, so the every-status listing indexes hold only the ships not
-- removed, and the pass picks the oldest retired ships not removed through
-- an index of its own.

-- AlterTable
ALTER TABLE "ships" ADD COLUMN "removed_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "ships_removal_idx" ON "ships"("fleet_id", "retired_at", "id") WHERE ((retired_at IS NOT NULL) AND (removed_at IS NULL));

DROP INDEX "ships_listing_every_status_idx";
DROP INDEX "ships_name_listing_every_status_idx";
CREATE INDEX "ships_listing_every_status_idx" ON "ships"("fleet_id", (kind <> 'operator'::ship_kind), (lower("name")) COLLATE "C", "id" COLLATE "C") WHERE ("removed_at" IS NULL);
CREATE INDEX "ships_name_listing_every_status_idx" ON "ships"("fleet_id", (lower("name")) COLLATE "C", "id" COLLATE "C") WHERE ("removed_at" IS NULL);
