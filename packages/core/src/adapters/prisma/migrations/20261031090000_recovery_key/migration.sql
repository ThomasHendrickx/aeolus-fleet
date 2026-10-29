-- Sealed fleets (decision 0068, B6): the recovery key's public half and its fingerprint, when the company set one.

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN "recovery_key" TEXT,
ADD COLUMN "recovery_key_fingerprint" TEXT;

-- A recovery key comes with its fingerprint, and only to a sealed fleet.
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_recovery_key_whole" CHECK (
  ("recovery_key" IS NULL AND "recovery_key_fingerprint" IS NULL)
  OR ("sealing_state" IS NOT NULL AND "recovery_key" IS NOT NULL AND "recovery_key_fingerprint" IS NOT NULL)
);
