CREATE TABLE "relays" (
    "fleet_id" TEXT NOT NULL,
    "relay_message_id" TEXT NOT NULL,
    "squadron_id" TEXT NOT NULL,
    "member_ship_id" TEXT NOT NULL,
    "member_message_id" TEXT NOT NULL,

    CONSTRAINT "relays_pkey" PRIMARY KEY ("fleet_id","relay_message_id")
);
