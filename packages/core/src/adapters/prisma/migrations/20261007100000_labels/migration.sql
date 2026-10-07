-- labels:define and labels:assign (decision 0031): defining labels and
-- assigning them. argo holds every scope, so each fleet's argo gets them too.
ALTER TABLE "ships" DROP CONSTRAINT "ships_scopes_known";
ALTER TABLE "ships" ADD CONSTRAINT "ships_scopes_known" CHECK (
  "scopes" IS NOT NULL AND "scopes" <@ ARRAY['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign']::TEXT[]
);

UPDATE "ships" SET "scopes" = array_append("scopes", 'labels:define') WHERE "kind" = 'operator' AND NOT ('labels:define' = ANY("scopes"));
UPDATE "ships" SET "scopes" = array_append("scopes", 'labels:assign') WHERE "kind" = 'operator' AND NOT ('labels:assign' = ANY("scopes"));

-- The labels, their values, each with its id, and the values each ship carries.
-- CreateTable
CREATE TABLE "labels" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "owner_ship_id" TEXT NOT NULL,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "label_values" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "label_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ship_labels" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "value_id" TEXT NOT NULL,

    CONSTRAINT "ship_labels_pkey" PRIMARY KEY ("fleet_id","ship_id","value_id")
);

-- CreateIndex
CREATE INDEX "labels_fleet_id_owner_ship_id_idx" ON "labels"("fleet_id", "owner_ship_id");

-- CreateIndex
CREATE UNIQUE INDEX "labels_fleet_id_id_key" ON "labels"("fleet_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "labels_fleet_id_key_key" ON "labels"("fleet_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "label_values_fleet_id_id_key" ON "label_values"("fleet_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "label_values_fleet_id_label_id_value_key" ON "label_values"("fleet_id", "label_id", "value");

-- CreateIndex
CREATE INDEX "ship_labels_fleet_id_label_id_idx" ON "ship_labels"("fleet_id", "label_id");

-- CreateIndex
CREATE INDEX "ship_labels_fleet_id_value_id_idx" ON "ship_labels"("fleet_id", "value_id");

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_fleet_id_owner_ship_id_fkey" FOREIGN KEY ("fleet_id", "owner_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_values" ADD CONSTRAINT "label_values_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_values" ADD CONSTRAINT "label_values_fleet_id_label_id_fkey" FOREIGN KEY ("fleet_id", "label_id") REFERENCES "labels"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_labels" ADD CONSTRAINT "ship_labels_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_labels" ADD CONSTRAINT "ship_labels_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_labels" ADD CONSTRAINT "ship_labels_fleet_id_label_id_fkey" FOREIGN KEY ("fleet_id", "label_id") REFERENCES "labels"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_labels" ADD CONSTRAINT "ship_labels_fleet_id_value_id_fkey" FOREIGN KEY ("fleet_id", "value_id") REFERENCES "label_values"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

