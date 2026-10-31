-- The alerts the watch raises on ships (decision 0071), open until cleared: one per ship, signal and occurrence.
-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "occurrence_key" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "owner_ship_id" TEXT,
    "since" TIMESTAMPTZ(3) NOT NULL,
    "raised_at" TIMESTAMPTZ(3) NOT NULL,
    "cleared_at" TIMESTAMPTZ(3),
    "cleared_why" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alerts_open_idx" ON "alerts"("fleet_id", "id" DESC) WHERE ("cleared_at" IS NULL);

-- CreateIndex
CREATE INDEX "alerts_open_on_ship_idx" ON "alerts"("fleet_id", "ship_id") WHERE ("cleared_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "alerts_fleet_id_ship_id_signal_occurrence_key_key" ON "alerts"("fleet_id", "ship_id", "signal", "occurrence_key");

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

