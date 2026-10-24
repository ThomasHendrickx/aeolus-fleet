-- A meeting's life (decision 0061, M13): a participant left or revoked, its row kept, as a former participant
-- reads the meeting and a ship that left keeps its right to rejoin.
-- AlterTable
ALTER TABLE "meeting_participants" ADD COLUMN     "is_revoked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "left_at" TIMESTAMPTZ(3);

