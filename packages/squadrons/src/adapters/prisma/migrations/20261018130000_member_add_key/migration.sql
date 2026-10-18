ALTER TABLE "members" ADD COLUMN "add_key" TEXT;
CREATE UNIQUE INDEX "members_fleet_id_squadron_id_add_key_key" ON "members"("fleet_id", "squadron_id", "add_key");
