-- CreateTable
CREATE TABLE "fleet_networks" (
    "fleet_id" TEXT NOT NULL,
    "rules" JSONB,
    "while_unavailable" TEXT NOT NULL,
    "not_responding_after_seconds" INTEGER NOT NULL,

    CONSTRAINT "fleet_networks_pkey" PRIMARY KEY ("fleet_id")
);
