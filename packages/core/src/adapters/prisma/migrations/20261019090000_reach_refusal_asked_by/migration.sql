-- The plugin ship that read on behalf of the sender (decision 0034); null for the sender's own call.
ALTER TABLE "reach_refusals" ADD COLUMN "asked_by" JSONB;
