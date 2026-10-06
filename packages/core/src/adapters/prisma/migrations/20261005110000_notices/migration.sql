-- Notices (decision 0023): the installation's console notices, which belong
-- to no fleet, and the ones each console session dismissed for itself.

-- CreateEnum
CREATE TYPE "notice_audience" AS ENUM ('everyone', 'operators', 'viewers');

-- CreateTable
CREATE TABLE "notices" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "audience" "notice_audience" NOT NULL,
    "text" TEXT NOT NULL,
    "links" JSONB NOT NULL DEFAULT '[]',
    "is_dismissible" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notice_dismissals" (
    "fleet_id" TEXT NOT NULL,
    "console_session_id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "dismissed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notice_dismissals_pkey" PRIMARY KEY ("console_session_id","notice_id")
);

-- CreateIndex
CREATE INDEX "notice_dismissals_fleet_id_idx" ON "notice_dismissals"("fleet_id");

-- AddForeignKey
ALTER TABLE "notice_dismissals" ADD CONSTRAINT "notice_dismissals_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_dismissals" ADD CONSTRAINT "notice_dismissals_console_session_id_fkey" FOREIGN KEY ("console_session_id") REFERENCES "console_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

