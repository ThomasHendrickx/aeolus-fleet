-- labels:define and labels:assign (decision 0031): defining labels and
-- assigning them. argo holds every scope, so each fleet's argo gets them too.
ALTER TABLE "ships" DROP CONSTRAINT "ships_scopes_known";
ALTER TABLE "ships" ADD CONSTRAINT "ships_scopes_known" CHECK (
  "scopes" IS NOT NULL AND "scopes" <@ ARRAY['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign']::TEXT[]
);

UPDATE "ships" SET "scopes" = array_append("scopes", 'labels:define') WHERE "kind" = 'operator' AND NOT ('labels:define' = ANY("scopes"));
UPDATE "ships" SET "scopes" = array_append("scopes", 'labels:assign') WHERE "kind" = 'operator' AND NOT ('labels:assign' = ANY("scopes"));

-- The labels and the labels each ship carries, one value per key.
-- CreateTable
CREATE TABLE "labels" (
    "fleet_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "values" TEXT[],
    "owner_ship_id" TEXT NOT NULL,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("fleet_id","key")
);

-- CreateTable
CREATE TABLE "ship_labels" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ship_labels_pkey" PRIMARY KEY ("fleet_id","ship_id","key")
);

-- CreateIndex
CREATE INDEX "labels_fleet_id_owner_ship_id_idx" ON "labels"("fleet_id", "owner_ship_id");

-- CreateIndex
CREATE INDEX "ship_labels_fleet_id_key_idx" ON "ship_labels"("fleet_id", "key");

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_fleet_id_owner_ship_id_fkey" FOREIGN KEY ("fleet_id", "owner_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_labels" ADD CONSTRAINT "ship_labels_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_labels" ADD CONSTRAINT "ship_labels_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_labels" ADD CONSTRAINT "ship_labels_fleet_id_key_fkey" FOREIGN KEY ("fleet_id", "key") REFERENCES "labels"("fleet_id", "key") ON DELETE RESTRICT ON UPDATE CASCADE;

