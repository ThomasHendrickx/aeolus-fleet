-- CreateTable
CREATE TABLE "crew_requests" (
    "ship_id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "settings_version" INTEGER NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crew_requests_pkey" PRIMARY KEY ("ship_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crew_requests_fleet_id_ship_id_key" ON "crew_requests"("fleet_id", "ship_id");

-- AddForeignKey
ALTER TABLE "crew_requests" ADD CONSTRAINT "crew_requests_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_requests" ADD CONSTRAINT "crew_requests_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

