-- The hooks of a pushed ship report its session's turn, idle or busy, with
-- the time they saw it; the lease keeps it (decision 0040).
CREATE TYPE "turn_state" AS ENUM ('idle', 'busy');

ALTER TABLE "leases" ADD COLUMN "turn" "turn_state";
ALTER TABLE "leases" ADD COLUMN "turn_at" TIMESTAMPTZ(3);
