-- A refusal records the verb the sender tried (decision 0034). Only sends were
-- checked before, so every refusal so far is a refused send.
ALTER TABLE "reach_refusals" ADD COLUMN IF NOT EXISTS "verb" TEXT NOT NULL DEFAULT 'send';
ALTER TABLE "reach_refusals" ALTER COLUMN "verb" DROP DEFAULT;
