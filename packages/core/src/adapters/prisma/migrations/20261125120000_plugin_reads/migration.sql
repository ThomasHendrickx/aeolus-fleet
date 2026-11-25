-- Counted read outcomes on active plugin ships.
ALTER TABLE "ships" ADD COLUMN "plugin_reads" JSONB;
