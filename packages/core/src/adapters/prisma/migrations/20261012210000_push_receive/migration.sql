-- A push receive takes a delivery for the computer side, which hands it to the
-- agent with a hand-over number, and marks its lease pushed (decision 0040).
ALTER TYPE "delivery_state" ADD VALUE 'received' BEFORE 'handed';

ALTER TABLE "deliveries" ADD COLUMN "hand_over_number" INTEGER;

ALTER TABLE "leases" ADD COLUMN "pushed_at" TIMESTAMPTZ(3);
