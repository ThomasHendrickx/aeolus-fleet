-- Sealed fleets (decision 0068, B7): a schedule's sealed payload beside its plain byte count, as a message's.

-- AlterTable
ALTER TABLE "schedules" ALTER COLUMN "payload" DROP NOT NULL,
ADD COLUMN "sealed_data_key_id" TEXT,
ADD COLUMN "sealed_nonce" BYTEA,
ADD COLUMN "sealed_ciphertext" BYTEA,
ADD COLUMN "sealed_payload_bytes" INTEGER;

-- A payload is plain, or sealed whole with its plain byte count within the 64 KB limit.
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_payload_plain_or_sealed" CHECK (
  ("payload" IS NOT NULL AND "sealed_data_key_id" IS NULL AND "sealed_nonce" IS NULL AND "sealed_ciphertext" IS NULL AND "sealed_payload_bytes" IS NULL)
  OR ("payload" IS NULL AND "sealed_data_key_id" IS NOT NULL AND "sealed_nonce" IS NOT NULL AND "sealed_ciphertext" IS NOT NULL AND "sealed_payload_bytes" BETWEEN 0 AND 65536)
);

-- A data key is never deleted while a schedule sealed under it is kept: the check reads this index.
CREATE INDEX "schedules_fleet_id_sealed_data_key_id_idx" ON "schedules"("fleet_id", "sealed_data_key_id");

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_fleet_id_sealed_data_key_id_fkey" FOREIGN KEY ("fleet_id", "sealed_data_key_id") REFERENCES "data_keys"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
