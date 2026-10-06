-- CreateEnum
CREATE TYPE "crew_status" AS ENUM ('crewing', 'running', 'restarting', 'crashed', 'releasing');

-- AlterTable
ALTER TABLE "crew_requests" ADD COLUMN     "assigned_to_ship_id" TEXT,
ADD COLUMN     "status" "crew_status";

-- CreateIndex
CREATE INDEX "crew_requests_fleet_id_assigned_to_ship_id_idx" ON "crew_requests"("fleet_id", "assigned_to_ship_id");

-- AddForeignKey
ALTER TABLE "crew_requests" ADD CONSTRAINT "crew_requests_fleet_id_assigned_to_ship_id_fkey" FOREIGN KEY ("fleet_id", "assigned_to_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

