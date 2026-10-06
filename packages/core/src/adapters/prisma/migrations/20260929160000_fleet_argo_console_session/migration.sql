-- CreateEnum
CREATE TYPE "ship_kind" AS ENUM ('operator', 'agent');

-- CreateEnum
CREATE TYPE "location_kind" AS ENUM ('DEVICE', 'CLOUD', 'SERVER', 'OTHER');

-- AlterEnum
ALTER TYPE "delivery_state" ADD VALUE 'dismissed';

-- DropForeignKey
ALTER TABLE "operator_sessions" DROP CONSTRAINT "operator_sessions_fleet_id_fkey";

-- DropForeignKey
ALTER TABLE "operator_sessions" DROP CONSTRAINT "operator_sessions_fleet_id_operator_id_fkey";

-- DropForeignKey
ALTER TABLE "operators" DROP CONSTRAINT "operators_fleet_id_fkey";

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "read_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "actor_ship_id" TEXT,
ADD COLUMN     "delivery_id" TEXT,
ADD COLUMN     "details" JSONB NOT NULL,
ADD COLUMN     "message_id" TEXT,
ADD COLUMN     "ship_id" TEXT;

-- AlterTable
ALTER TABLE "leases" ADD COLUMN     "location" "location_kind" NOT NULL,
ADD COLUMN     "location_description" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "in_reply_to_message_id" TEXT,
ADD COLUMN     "resend_of_message_id" TEXT;

-- AlterTable
ALTER TABLE "ships" ADD COLUMN     "kind" "ship_kind" NOT NULL,
ADD COLUMN     "scopes" TEXT[];

-- DropTable
DROP TABLE "operator_sessions";

-- DropTable
DROP TABLE "operators";

-- CreateTable
CREATE TABLE "console_sessions" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "console_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "console_sessions_token_hash_key" ON "console_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "console_sessions_fleet_id_open_key" ON "console_sessions"("fleet_id") WHERE ("ended_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "credentials_secret_hash_key" ON "credentials"("secret_hash");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_fleet_id_id_key" ON "deliveries"("fleet_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "leases_fleet_id_id_key" ON "leases"("fleet_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ships_fleet_id_operator_key" ON "ships"("fleet_id") WHERE (kind = 'operator'::ship_kind);

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_fleet_id_in_reply_to_message_id_fkey" FOREIGN KEY ("fleet_id", "in_reply_to_message_id") REFERENCES "messages"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_fleet_id_resend_of_message_id_fkey" FOREIGN KEY ("fleet_id", "resend_of_message_id") REFERENCES "messages"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_fleet_id_actor_ship_id_fkey" FOREIGN KEY ("fleet_id", "actor_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_fleet_id_message_id_fkey" FOREIGN KEY ("fleet_id", "message_id") REFERENCES "messages"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_fleet_id_delivery_id_fkey" FOREIGN KEY ("fleet_id", "delivery_id") REFERENCES "deliveries"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "console_sessions" ADD CONSTRAINT "console_sessions_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "console_sessions" ADD CONSTRAINT "console_sessions_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "console_sessions" ADD CONSTRAINT "console_sessions_fleet_id_lease_id_fkey" FOREIGN KEY ("fleet_id", "lease_id") REFERENCES "leases"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Written by hand from here on: rules Prisma does not model.

-- Scopes are never null and only the four known ones.
ALTER TABLE "ships" ADD CONSTRAINT "ships_scopes_known" CHECK (
  "scopes" IS NOT NULL AND "scopes" <@ ARRAY['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage']::TEXT[]
);

-- The operator ship is named argo, and no other ship ever is (ADR 0012).
ALTER TABLE "ships" ADD CONSTRAINT "ships_operator_is_argo" CHECK (("kind" = 'operator') = ("name" = 'argo'));

-- The operator ship is never retired.
ALTER TABLE "ships" ADD CONSTRAINT "ships_operator_never_retired" CHECK ("kind" <> 'operator' OR "retired_at" IS NULL);

-- An OTHER location carries a description; the other kinds carry none.
ALTER TABLE "leases" ADD CONSTRAINT "leases_location_description" CHECK (
  CASE
    WHEN "location" = 'OTHER' THEN "location_description" IS NOT NULL AND btrim("location_description") <> ''
    ELSE "location_description" IS NULL
  END
);

-- Event details are a flat JSON object.
ALTER TABLE "events" ADD CONSTRAINT "events_details_object" CHECK (jsonb_typeof("details") = 'object');
