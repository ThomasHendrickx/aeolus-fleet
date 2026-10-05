-- The guide (decision 0024): the installation's guide, which belongs to no
-- fleet, and where each console session is in it.

-- CreateEnum
CREATE TYPE "guide_progress_state" AS ENUM ('open', 'skipped', 'finished');

-- CreateTable
CREATE TABLE "guides" (
    "id" TEXT NOT NULL,
    "audience" "notice_audience" NOT NULL,
    "steps" JSONB NOT NULL,

    CONSTRAINT "guides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_progress" (
    "fleet_id" TEXT NOT NULL,
    "console_session_id" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "state" "guide_progress_state" NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guide_progress_pkey" PRIMARY KEY ("console_session_id")
);

-- CreateIndex
CREATE INDEX "guide_progress_fleet_id_idx" ON "guide_progress"("fleet_id");

-- AddForeignKey
ALTER TABLE "guide_progress" ADD CONSTRAINT "guide_progress_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_progress" ADD CONSTRAINT "guide_progress_console_session_id_fkey" FOREIGN KEY ("console_session_id") REFERENCES "console_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
