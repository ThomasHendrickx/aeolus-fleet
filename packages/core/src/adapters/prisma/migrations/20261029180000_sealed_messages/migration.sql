-- Sealed fleets (decision 0068, B4, B7, B18): a fleet's sealing, a message's
-- sealed payload beside its plain byte count, and the question uuid in its own column.

-- CreateEnum
CREATE TYPE "SealingState" AS ENUM ('sealing', 'sealed');

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN "sealing_state" "SealingState",
ADD COLUMN "company_key" TEXT;

-- A fleet is sealed under a company key, or neither.
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_sealing_whole" CHECK (("sealing_state" IS NULL) = ("company_key" IS NULL));

-- AlterTable
ALTER TABLE "messages" ALTER COLUMN "payload" DROP NOT NULL,
ADD COLUMN "sealed_data_key_id" TEXT,
ADD COLUMN "sealed_nonce" BYTEA,
ADD COLUMN "sealed_ciphertext" BYTEA,
ADD COLUMN "sealed_payload_bytes" INTEGER,
ADD COLUMN "question_id" TEXT;

-- A payload is plain, or sealed whole with its plain byte count within the 64 KB limit.
ALTER TABLE "messages" ADD CONSTRAINT "messages_payload_plain_or_sealed" CHECK (
  ("payload" IS NOT NULL AND "sealed_data_key_id" IS NULL AND "sealed_nonce" IS NULL AND "sealed_ciphertext" IS NULL AND "sealed_payload_bytes" IS NULL)
  OR ("payload" IS NULL AND "sealed_data_key_id" IS NOT NULL AND "sealed_nonce" IS NOT NULL AND "sealed_ciphertext" IS NOT NULL AND "sealed_payload_bytes" BETWEEN 0 AND 65536)
);

-- The question uuid each withdrawal and replacement names, as the old index read it.
UPDATE "messages" SET "question_id" = substring("payload" from '"questionId"\s*:\s*"([^"]*)"')
WHERE lower("content_type") LIKE 'application/vnd.aeolus.question-%';

-- DropIndex
DROP INDEX "messages_question_id_idx";

-- CreateIndex
CREATE INDEX "messages_fleet_id_question_id_idx" ON "messages"("fleet_id", "question_id") WHERE ("question_id" IS NOT NULL);

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_fleet_id_sealed_data_key_id_fkey" FOREIGN KEY ("fleet_id", "sealed_data_key_id") REFERENCES "data_keys"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
