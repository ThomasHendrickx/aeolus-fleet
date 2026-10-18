-- An add-member key is its sender's own (decision 0017): a member keeps the sender of the request it was added by,
-- and a key repeats only that sender's request. A member added before keeps its key without a sender, so no
-- request finds it again.
ALTER TABLE "members" ADD COLUMN "add_by" TEXT;
DROP INDEX "members_fleet_id_squadron_id_add_key_key";
CREATE UNIQUE INDEX "members_fleet_id_squadron_id_add_by_add_key_key" ON "members"("fleet_id", "squadron_id", "add_by", "add_key");
