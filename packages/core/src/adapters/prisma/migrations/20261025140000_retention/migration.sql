-- Retention as configuration (decision 0066): the installation's default
-- retention in days, and how a fleet sets its own (null for kept for good),
-- or the installation default when not set.
ALTER TABLE "installation_settings" ADD COLUMN "default_retention_days" INTEGER;

ALTER TABLE "fleets" ADD COLUMN "retention_set" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "retention_days" INTEGER;
