-- The mic of a meeting (decision 0061, M7 to M9): the participant that holds it, how a free mic passes, and
-- the participants waiting for it in order. A meeting opens with the mic free, given by the moderator.
-- CreateEnum
CREATE TYPE "mic_pattern" AS ENUM ('moderator', 'fifo');

-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "mic_holder_ship_id" TEXT,
ADD COLUMN     "mic_pattern" "mic_pattern" NOT NULL DEFAULT 'moderator';

-- CreateTable
CREATE TABLE "meeting_mic_requests" (
    "fleet_id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "place" INTEGER NOT NULL,

    CONSTRAINT "meeting_mic_requests_pkey" PRIMARY KEY ("fleet_id","meeting_id","ship_id")
);

-- CreateIndex
CREATE INDEX "meetings_fleet_id_mic_holder_ship_id_idx" ON "meetings"("fleet_id", "mic_holder_ship_id");

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_fleet_id_mic_holder_ship_id_fkey" FOREIGN KEY ("fleet_id", "mic_holder_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_mic_requests" ADD CONSTRAINT "meeting_mic_requests_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_mic_requests" ADD CONSTRAINT "meeting_mic_requests_fleet_id_meeting_id_fkey" FOREIGN KEY ("fleet_id", "meeting_id") REFERENCES "meetings"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_mic_requests" ADD CONSTRAINT "meeting_mic_requests_fleet_id_meeting_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "meeting_id", "ship_id") REFERENCES "meeting_participants"("fleet_id", "meeting_id", "ship_id") ON DELETE RESTRICT ON UPDATE CASCADE;

