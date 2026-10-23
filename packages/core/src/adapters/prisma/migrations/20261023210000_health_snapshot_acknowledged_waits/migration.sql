-- Each closed hour's acknowledged waits summed over every message
-- (docs/design/performance/performance.md, decision 10), so a reader of every
-- ship reads 24 small sums instead of every message's waits. The hours
-- already closed are summed here from their waits by message.
ALTER TABLE "health_snapshots" ADD COLUMN "acknowledged_waits" JSONB;

UPDATE "health_snapshots" s SET "acknowledged_waits" = COALESCE((
  SELECT jsonb_agg(jsonb_build_array(bucket, count) ORDER BY bucket) FROM (
    SELECT (w->>0)::int AS bucket, sum((w->>1)::int)::int AS count
    FROM jsonb_array_elements(s."acknowledged") a, jsonb_array_elements(a->'waits') w
    GROUP BY 1
  ) summed
), '[]'::jsonb);

ALTER TABLE "health_snapshots" ALTER COLUMN "acknowledged_waits" SET NOT NULL;
