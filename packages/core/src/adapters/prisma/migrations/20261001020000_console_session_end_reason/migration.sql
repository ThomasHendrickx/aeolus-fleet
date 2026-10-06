-- CreateEnum
CREATE TYPE "console_session_end_reason" AS ENUM ('takenOver', 'signedOut', 'passwordReset');

-- AlterTable
ALTER TABLE "console_sessions" ADD COLUMN     "end_reason" "console_session_end_reason";


-- Written by hand from here on: rules Prisma does not model.

-- Only an ended session has a reason. Sessions that ended before this
-- migration keep none: why they ended was not recorded.
ALTER TABLE "console_sessions" ADD CONSTRAINT "console_sessions_end_reason" CHECK (
  "end_reason" IS NULL OR "ended_at" IS NOT NULL
);
