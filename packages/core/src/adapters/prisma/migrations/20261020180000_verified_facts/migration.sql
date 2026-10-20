-- One writer's verified facts about a ship (decision 0059): what it checked, set whole and kept with the ship.
-- CreateEnum
CREATE TYPE "fact_writer_kind" AS ENUM ('ship', 'account', 'installation');

-- CreateTable
CREATE TABLE "verified_facts" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "writer_kind" "fact_writer_kind" NOT NULL,
    "writer" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "written_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verified_facts_pkey" PRIMARY KEY ("fleet_id","ship_id","writer_kind","writer")
);

-- AddForeignKey
ALTER TABLE "verified_facts" ADD CONSTRAINT "verified_facts_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verified_facts" ADD CONSTRAINT "verified_facts_fleet_id_ship_id_fkey" FOREIGN KEY ("fleet_id", "ship_id") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
