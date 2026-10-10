-- Whether a crew request's crew is final (#472): set by its trierarch's first
-- running, restarting or crashed and kept whatever status follows. A request
-- whose status is one of those now is final already.
-- AlterTable
ALTER TABLE "crew_requests" ADD COLUMN "is_final" BOOLEAN NOT NULL DEFAULT false;

UPDATE "crew_requests" SET "is_final" = true WHERE "status" IN ('running', 'restarting', 'crashed');
