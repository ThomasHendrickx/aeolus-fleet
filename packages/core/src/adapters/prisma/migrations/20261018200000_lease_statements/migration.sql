-- A crew's statement, kept with its lease and versioned (decision 0047).
ALTER TABLE "leases" ADD COLUMN "statement" JSONB;
ALTER TABLE "leases" ADD COLUMN "statement_version" INTEGER NOT NULL DEFAULT 0;
