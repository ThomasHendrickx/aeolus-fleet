-- A deleted fleet reads as gone at once; the removal pass takes its rows away in batches (decision 0020).
ALTER TABLE "fleets" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
