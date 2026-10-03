-- CreateTable
CREATE TABLE "management_crew" (
    "key" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "crew_token" TEXT NOT NULL,
    "crewed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "management_crew_pkey" PRIMARY KEY ("key")
);
