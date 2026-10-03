-- CreateTable
CREATE TABLE "flagship_messages" (
    "fleet_id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "squadron_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "sender_ship_id" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "in_reply_to" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "flagship_messages_pkey" PRIMARY KEY ("delivery_id")
);

-- CreateIndex
CREATE INDEX "flagship_messages_fleet_id_squadron_id_received_at_idx" ON "flagship_messages"("fleet_id", "squadron_id", "received_at");
