-- A type delivery under network rules keeps the ships of the type its sender
-- may reach, fixed at send time (decision 0034); empty for any ship of the type,
-- as every delivery stored before had.
-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "reachable_ship_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
