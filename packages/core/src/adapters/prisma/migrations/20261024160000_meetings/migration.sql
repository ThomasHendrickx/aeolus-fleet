-- Meetings (decision 0061): a meeting of ships with its owner, moderator and opener, its participants, and
-- the meeting a message was sent to or tells of. A message to a meeting has the selector kind meeting.
ALTER TYPE "selector_kind" ADD VALUE 'meeting';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "meeting_id" TEXT;

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "title" TEXT,
    "owner_ship_id" TEXT NOT NULL,
    "moderator_ship_id" TEXT NOT NULL,
    "opened_by_ship_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "fleet_id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL,
    "place" INTEGER NOT NULL,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("fleet_id","meeting_id","ship_id")
);

-- CreateIndex
CREATE INDEX "meetings_fleet_id_owner_ship_id_idx" ON "meetings"("fleet_id", "owner_ship_id");

-- CreateIndex
CREATE INDEX "meetings_fleet_id_moderator_ship_id_idx" ON "meetings"("fleet_id", "moderator_ship_id");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_fleet_id_id_key" ON "meetings"("fleet_id", "id");

-- An opener uses an idempotency key once.
-- CreateIndex
CREATE UNIQUE INDEX "meetings_fleet_id_opened_by_ship_id_idempotency_key_key" ON "meetings"("fleet_id", "opened_by_ship_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "meeting_participants_fleet_id_ship_id_idx" ON "meeting_participants"("fleet_id", "ship_id");

-- A meeting's contributions page newest first by id.
-- CreateIndex
CREATE INDEX "messages_fleet_id_meeting_id_id_idx" ON "messages"("fleet_id", "meeting_id", "id");

-- A meeting selector names its meeting and no ship or type. The new value is read as text: an enum value
-- added in a transaction cannot be used in it.
ALTER TABLE "messages" DROP CONSTRAINT "messages_one_selector";
ALTER TABLE "messages" ADD CONSTRAINT "messages_one_selector" CHECK (
  ("selector_kind"::text = 'ship' AND "selector_ship_id" IS NOT NULL AND "selector_type" IS NULL)
  OR ("selector_kind"::text = 'type' AND "selector_type" IS NOT NULL AND "selector_ship_id" IS NULL)
  OR ("selector_kind"::text = 'meeting' AND "meeting_id" IS NOT NULL AND "selector_ship_id" IS NULL AND "selector_type" IS NULL)
);

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_fleet_id_meeting_id_fkey" FOREIGN KEY ("fleet_id", "meeting_id") REFERENCES "meetings"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_fleet_id_owner_ship_id_fkey" FOREIGN KEY ("fleet_id", "owner_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_fleet_id_moderator_ship_id_fkey" FOREIGN KEY ("fleet_id", "moderator_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_fleet_id_opened_by_ship_id_fkey" FOREIGN KEY ("fleet_id", "opened_by_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_fleet_id_meeting_id_fkey" FOREIGN KEY ("fleet_id", "meeting_id") REFERENCES "meetings"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
