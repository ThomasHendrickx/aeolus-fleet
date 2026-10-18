ALTER TABLE "squadrons" ADD COLUMN "forming_ship_id" TEXT;
ALTER TABLE "squadrons" ADD COLUMN "forming_ship_name" TEXT;
ALTER TABLE "squadrons" ADD COLUMN "form_key" TEXT;
CREATE UNIQUE INDEX "squadrons_fleet_id_forming_ship_id_form_key_key" ON "squadrons"("fleet_id", "forming_ship_id", "form_key");
