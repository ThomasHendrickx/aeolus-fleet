-- CreateTable
CREATE TABLE "sign_in_tickets" (
    "token_hash" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "sign_in_tickets_pkey" PRIMARY KEY ("token_hash")
);

-- CreateIndex
CREATE INDEX "sign_in_tickets_fleet_id_idx" ON "sign_in_tickets"("fleet_id");

-- AddForeignKey
ALTER TABLE "sign_in_tickets" ADD CONSTRAINT "sign_in_tickets_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
