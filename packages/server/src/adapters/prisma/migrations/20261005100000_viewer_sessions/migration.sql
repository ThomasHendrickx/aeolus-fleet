-- Viewer sessions (decision 0022): console sessions of the viewer ship, many at
-- once, holding no lease, each with its own idle limit and a moment it ends by.

-- At most one viewer ship per fleet, as one operator ship.
CREATE UNIQUE INDEX "ships_fleet_id_viewer_key" ON "ships"("fleet_id") WHERE (kind = 'viewer'::ship_kind);

ALTER TABLE "console_sessions" ALTER COLUMN "lease_id" DROP NOT NULL;
-- Every session so far is the operator's, valid 30 days after its last use.
ALTER TABLE "console_sessions" ADD COLUMN "idle_limit_seconds" INTEGER NOT NULL DEFAULT 2592000;
ALTER TABLE "console_sessions" ALTER COLUMN "idle_limit_seconds" DROP DEFAULT;
ALTER TABLE "console_sessions" ADD COLUMN "ends_by" TIMESTAMPTZ(3);

-- One live session holding argo's lease per fleet; viewer sessions hold none and run beside it.
DROP INDEX "console_sessions_fleet_id_open_key";
CREATE UNIQUE INDEX "console_sessions_fleet_id_open_key" ON "console_sessions"("fleet_id") WHERE ("ended_at" IS NULL AND "lease_id" IS NOT NULL);

-- Whom a sign-in ticket signs in as. Every ticket so far is the operator's.
CREATE TYPE "sign_in_as" AS ENUM ('operator', 'viewer');
ALTER TABLE "sign_in_tickets" ADD COLUMN "sign_in_as" "sign_in_as" NOT NULL DEFAULT 'operator';
ALTER TABLE "sign_in_tickets" ALTER COLUMN "sign_in_as" DROP DEFAULT;
