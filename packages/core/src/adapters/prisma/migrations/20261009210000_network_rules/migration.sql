-- The fleet's network settings and the records of the sends they refused
-- (decision 0034).
-- CreateTable
CREATE TABLE "network_settings" (
    "fleet_id" TEXT NOT NULL,
    "rules" JSONB,
    "version" INTEGER NOT NULL,

    CONSTRAINT "network_settings_pkey" PRIMARY KEY ("fleet_id")
);

-- CreateTable
CREATE TABLE "reach_refusals" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "sender" JSONB NOT NULL,
    "recipient" JSONB NOT NULL,
    "settings_version" INTEGER NOT NULL,

    CONSTRAINT "reach_refusals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reach_refusals_fleet_id_at_idx" ON "reach_refusals"("fleet_id", "at");

-- AddForeignKey
ALTER TABLE "network_settings" ADD CONSTRAINT "network_settings_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reach_refusals" ADD CONSTRAINT "reach_refusals_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
