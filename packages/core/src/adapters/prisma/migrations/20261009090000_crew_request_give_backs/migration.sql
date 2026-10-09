-- A trierarch that gave a crew request back before its crew was final (#382),
-- one per request and trierarch, cleared on every new settings version.
-- Every foreign key leads an index.
-- CreateTable
CREATE TABLE "crew_request_give_backs" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "trierarch_ship_id" TEXT NOT NULL,
    "settings_version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "given_back_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crew_request_give_backs_pkey" PRIMARY KEY ("fleet_id","ship_id","trierarch_ship_id")
);

-- CreateIndex
CREATE INDEX "crew_request_give_backs_fleet_id_trierarch_ship_id_idx" ON "crew_request_give_backs"("fleet_id", "trierarch_ship_id");

-- AddForeignKey
ALTER TABLE "crew_request_give_backs" ADD CONSTRAINT "crew_request_give_backs_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_request_give_backs" ADD CONSTRAINT "crew_request_give_backs_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "crew_requests"("fleet_id", "ship_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_request_give_backs" ADD CONSTRAINT "crew_request_give_backs_fleet_id_trierarch_ship_id_fkey" FOREIGN KEY ("fleet_id", "trierarch_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
