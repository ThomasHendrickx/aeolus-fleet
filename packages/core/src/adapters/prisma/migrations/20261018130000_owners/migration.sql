-- Every ship but argo and the viewer has an owner: a person's ship or argo (decision 0045).
ALTER TABLE "ships" ADD COLUMN "owner_ship_id" TEXT;

CREATE INDEX "ships_fleet_id_owner_ship_id_idx" ON "ships"("fleet_id", "owner_ship_id");

ALTER TABLE "ships" ADD CONSTRAINT "ships_fleet_id_owner_ship_id_fkey" FOREIGN KEY ("fleet_id", "owner_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The ships from before owners are argo's, retired ones included.
UPDATE "ships" AS ship
SET "owner_ship_id" = argo."id"
FROM "ships" AS argo
WHERE argo."fleet_id" = ship."fleet_id"
  AND argo."kind" = 'operator'
  AND ship."kind" NOT IN ('operator', 'viewer');
