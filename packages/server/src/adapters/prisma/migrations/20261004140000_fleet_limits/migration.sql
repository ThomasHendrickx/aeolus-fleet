-- How a fleet sets its ship and daily message limits: its own (null for no
-- limit), or the installation default when not set.
ALTER TABLE "fleets" ADD COLUMN "ship_limit_set" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "ship_limit" INTEGER,
ADD COLUMN "daily_message_limit_set" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "daily_message_limit" INTEGER;
