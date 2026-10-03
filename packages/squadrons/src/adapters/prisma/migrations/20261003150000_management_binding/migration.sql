-- AlterTable
ALTER TABLE "management_crew" ADD COLUMN     "ship_name" TEXT NOT NULL DEFAULT 'squadrons',
ALTER COLUMN "crew_token" DROP NOT NULL;

-- The default only names rows kept before this migration.
ALTER TABLE "management_crew" ALTER COLUMN "ship_name" DROP DEFAULT;
