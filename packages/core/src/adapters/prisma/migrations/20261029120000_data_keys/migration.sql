-- A sealed fleet's data keys (decision 0068, B6): kept only wrapped, with a check value; one current per fleet.

-- CreateTable
CREATE TABLE "data_keys" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "wrapped_by_company_key" BYTEA NOT NULL,
    "wrapped_by_recovery_key" BYTEA,
    "check_value" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "is_current" BOOLEAN NOT NULL,

    CONSTRAINT "data_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_keys_fleet_id_id_key" ON "data_keys"("fleet_id", "id");

-- One current data key per fleet.
CREATE UNIQUE INDEX "data_keys_fleet_id_current_key" ON "data_keys"("fleet_id") WHERE ("is_current" = true);

-- AddForeignKey
ALTER TABLE "data_keys" ADD CONSTRAINT "data_keys_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
