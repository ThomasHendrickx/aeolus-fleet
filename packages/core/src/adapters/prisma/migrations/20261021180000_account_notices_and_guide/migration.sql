-- Notices and the guide for an account signed in to the console as itself
-- (accounts design, A9): the audience accounts, and its dismissals and guide
-- progress kept by its account id in each fleet. Core stores no account: the
-- id is pagasae's.
ALTER TYPE "notice_audience" ADD VALUE 'accounts';

CREATE TABLE "account_notice_dismissals" (
    "fleet_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "dismissed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_notice_dismissals_pkey" PRIMARY KEY ("fleet_id", "account_id", "notice_id")
);

CREATE TABLE "account_guide_progress" (
    "fleet_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "state" "guide_progress_state" NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_guide_progress_pkey" PRIMARY KEY ("fleet_id", "account_id")
);

ALTER TABLE "account_notice_dismissals" ADD CONSTRAINT "account_notice_dismissals_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "account_guide_progress" ADD CONSTRAINT "account_guide_progress_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
