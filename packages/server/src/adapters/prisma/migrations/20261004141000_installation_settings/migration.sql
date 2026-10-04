-- CreateTable
CREATE TABLE "installation_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "default_ship_limit" INTEGER,
    "default_daily_message_limit" INTEGER,
    "fleet_cap" INTEGER,

    CONSTRAINT "installation_settings_pkey" PRIMARY KEY ("id")
);

-- The installation has one set of settings: one row at most.
ALTER TABLE "installation_settings" ADD CONSTRAINT "installation_settings_one_row" CHECK ("id" = 1);
