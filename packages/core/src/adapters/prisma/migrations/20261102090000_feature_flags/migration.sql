-- Feature flags per fleet (decision 0069): a row per flag that is on, none being off.

-- CreateTable
CREATE TABLE "fleet_feature_flags" (
    "fleet_id" TEXT NOT NULL,
    "flag" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fleet_feature_flags_pkey" PRIMARY KEY ("fleet_id","flag")
);

-- AddForeignKey
ALTER TABLE "fleet_feature_flags" ADD CONSTRAINT "fleet_feature_flags_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A fleet that is sealing or sealed keeps sealing: its flag starts on. Every other fleet starts with none.
INSERT INTO "fleet_feature_flags" ("fleet_id", "flag", "created_at")
SELECT f."id", 'sealing', now() FROM "fleets" f WHERE f."sealing_state" IS NOT NULL;
