-- CreateEnum
CREATE TYPE "delivery_state" AS ENUM ('pending', 'delivered', 'acknowledged', 'undeliverable', 'abandoned');

-- CreateTable
CREATE TABLE "fleets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fleets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ships" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "retired_at" TIMESTAMPTZ(3),

    CONSTRAINT "ships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leases" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "claimed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "recipient_ship_id" TEXT,
    "recipient_type" TEXT,
    "state" "delivery_state" NOT NULL DEFAULT 'pending',
    "claimed_by_ship_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operators" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_sessions" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operator_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ships_fleet_id_id_key" ON "ships"("fleet_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ships_fleet_id_name_active_key" ON "ships"("fleet_id", "name") WHERE ("retired_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "leases_ship_id_open_key" ON "leases"("ship_id") WHERE ("ended_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "credentials_ship_id_valid_key" ON "credentials"("ship_id") WHERE ("invalidated_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "messages_fleet_id_id_key" ON "messages"("fleet_id", "id");

-- CreateIndex
CREATE INDEX "deliveries_fleet_id_recipient_ship_id_state_idx" ON "deliveries"("fleet_id", "recipient_ship_id", "state");

-- CreateIndex
CREATE INDEX "deliveries_fleet_id_recipient_type_state_idx" ON "deliveries"("fleet_id", "recipient_type", "state");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_message_id_recipient_ship_id_key" ON "deliveries"("message_id", "recipient_ship_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_message_id_recipient_type_key" ON "deliveries"("message_id", "recipient_type");

-- CreateIndex
CREATE UNIQUE INDEX "operators_fleet_id_id_key" ON "operators"("fleet_id", "id");

-- AddForeignKey
ALTER TABLE "ships" ADD CONSTRAINT "ships_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_fleet_id_message_id_fkey" FOREIGN KEY ("fleet_id", "message_id") REFERENCES "messages"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_fleet_id_recipient_ship_id_fkey" FOREIGN KEY ("fleet_id", "recipient_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_fleet_id_claimed_by_ship_id_fkey" FOREIGN KEY ("fleet_id", "claimed_by_ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operators" ADD CONSTRAINT "operators_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_sessions" ADD CONSTRAINT "operator_sessions_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_sessions" ADD CONSTRAINT "operator_sessions_fleet_id_operator_id_fkey" FOREIGN KEY ("fleet_id", "operator_id") REFERENCES "operators"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Written by hand from here on: rules Prisma does not model.

-- A payload is at most 64 KB, counted in bytes.
ALTER TABLE "messages" ADD CONSTRAINT "messages_payload_max_64kb" CHECK (octet_length("payload") <= 65536);

-- A delivery goes to exactly one recipient: a ship or a type.
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_one_recipient" CHECK (num_nonnulls("recipient_ship_id", "recipient_type") = 1);

-- Events are append-only: never updated, deleted or truncated.
CREATE FUNCTION "events_reject_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'events are append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER "events_append_only"
  BEFORE UPDATE OR DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION "events_reject_change"();

CREATE TRIGGER "events_no_truncate"
  BEFORE TRUNCATE ON "events"
  FOR EACH STATEMENT EXECUTE FUNCTION "events_reject_change"();
