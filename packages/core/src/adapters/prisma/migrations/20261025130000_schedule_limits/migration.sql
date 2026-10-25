-- How a fleet sets the schedules each ship may hold and the minimum interval
-- of a repeating schedule in seconds (decision 0062): its own (null for no
-- limit), or the installation default when not set.
ALTER TABLE "fleets" ADD COLUMN "schedules_per_ship_limit_set" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "schedules_per_ship_limit" INTEGER,
ADD COLUMN "minimum_schedule_interval_set" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "minimum_schedule_interval" INTEGER;

-- The installation's defaults for both, null for no limit.
ALTER TABLE "installation_settings" ADD COLUMN "default_schedules_per_ship_limit" INTEGER,
ADD COLUMN "default_minimum_schedule_interval" INTEGER;
