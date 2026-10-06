-- AlterTable
ALTER TABLE "ships" ADD COLUMN     "commission_key" TEXT,
ADD COLUMN     "commission_request_hash" TEXT,
ADD COLUMN     "commissioned_by" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ships_fleet_id_commissioned_by_commission_key_key" ON "ships"("fleet_id", "commissioned_by", "commission_key");
