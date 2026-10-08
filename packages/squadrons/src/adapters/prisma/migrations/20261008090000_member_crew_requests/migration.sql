-- AlterTable
ALTER TABLE "members" ADD COLUMN "releasing_since" TIMESTAMPTZ(3),
ADD COLUMN "parameters" JSONB NOT NULL DEFAULT '{}';
