-- The crew status carries the restart attempt and when the session started (#332):
-- written by the assigned trierarch with the status.
ALTER TABLE "crew_requests" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "crew_requests" ADD COLUMN "session_started_at" TIMESTAMPTZ(3);
