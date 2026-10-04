-- CreateEnum
CREATE TYPE "installation_request_kind" AS ENUM ('create_fleet', 'delete_fleet');

-- CreateTable
CREATE TABLE "installation_requests" (
    "request_id" TEXT NOT NULL,
    "kind" "installation_request_kind" NOT NULL,
    "request_hash" TEXT NOT NULL,
    "fleet_id" TEXT,
    "operator_ship_id" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "installation_requests_pkey" PRIMARY KEY ("request_id")
);

-- CreateIndex
CREATE INDEX "installation_requests_fleet_id_idx" ON "installation_requests"("fleet_id");

-- A create names its fleet and argo; a delete names nothing of the fleet it deleted.
ALTER TABLE "installation_requests" ADD CONSTRAINT "installation_requests_create_names_its_fleet"
  CHECK (("kind" = 'create_fleet') = ("fleet_id" IS NOT NULL AND "operator_ship_id" IS NOT NULL));
