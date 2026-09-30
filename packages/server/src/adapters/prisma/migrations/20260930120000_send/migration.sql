-- No message was stored before this migration: nothing sent one yet. So the
-- new required columns need no default for existing rows.

-- CreateEnum
CREATE TYPE "selector_kind" AS ENUM ('ship', 'type');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "request_hash" TEXT NOT NULL,
ADD COLUMN     "selector_kind" "selector_kind" NOT NULL,
ADD COLUMN     "selector_ship_id" TEXT,
ADD COLUMN     "selector_type" TEXT,
ADD COLUMN     "sender_ship_id" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "messages_fleet_id_sender_ship_id_idempotency_key_key" ON "messages"("fleet_id", "sender_ship_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_fleet_id_sender_ship_id_fkey" FOREIGN KEY ("fleet_id", "sender_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_fleet_id_selector_ship_id_fkey" FOREIGN KEY ("fleet_id", "selector_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Written by hand from here on: rules Prisma does not model.

-- A ship selector names a ship's id and no type; a type selector names a type and no ship.
ALTER TABLE "messages" ADD CONSTRAINT "messages_one_selector" CHECK (
  ("selector_kind" = 'ship' AND "selector_ship_id" IS NOT NULL AND "selector_type" IS NULL)
  OR ("selector_kind" = 'type' AND "selector_type" IS NOT NULL AND "selector_ship_id" IS NULL)
);
