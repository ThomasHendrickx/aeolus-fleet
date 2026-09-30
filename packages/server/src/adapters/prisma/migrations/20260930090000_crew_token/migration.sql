-- AlterTable
ALTER TABLE "leases" ADD COLUMN     "crew_token_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "leases_crew_token_hash_key" ON "leases"("crew_token_hash");
