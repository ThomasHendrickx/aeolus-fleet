-- CreateTable
CREATE TABLE "squadrons" (
    "fleet_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "blueprint" JSONB NOT NULL,
    "templates" JSONB NOT NULL,
    "flagship_ship_id" TEXT NOT NULL,
    "flagship_name" TEXT NOT NULL,
    "flagship_crew_token" TEXT NOT NULL,
    "formed_at" TIMESTAMPTZ(3) NOT NULL,
    "sailed_at" TIMESTAMPTZ(3),

    CONSTRAINT "squadrons_pkey" PRIMARY KEY ("fleet_id","id"),
    CONSTRAINT "squadrons_state_check" CHECK ("state" IN ('forming', 'sailing', 'standing-down', 'disbanded'))
);

-- CreateTable
CREATE TABLE "members" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "squadron_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "on_station_at" TIMESTAMPTZ(3),

    CONSTRAINT "members_pkey" PRIMARY KEY ("ship_id")
);

-- CreateIndex
CREATE INDEX "members_fleet_id_squadron_id_idx" ON "members"("fleet_id", "squadron_id");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_fleet_id_squadron_id_fkey" FOREIGN KEY ("fleet_id", "squadron_id") REFERENCES "squadrons"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
