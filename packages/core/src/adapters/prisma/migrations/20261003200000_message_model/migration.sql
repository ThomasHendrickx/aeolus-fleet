-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "model" TEXT;

-- CreateIndex
CREATE INDEX "messages_fleet_id_sender_ship_id_created_at_idx" ON "messages"("fleet_id", "sender_ship_id", "created_at");
