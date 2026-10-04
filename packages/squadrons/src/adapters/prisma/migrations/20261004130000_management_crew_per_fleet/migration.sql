-- One management connection per fleet: the fleet is the key, the singleton key goes.
ALTER TABLE "management_crew" DROP CONSTRAINT "management_crew_pkey";
ALTER TABLE "management_crew" DROP COLUMN "key";
ALTER TABLE "management_crew" ADD CONSTRAINT "management_crew_pkey" PRIMARY KEY ("fleet_id");
