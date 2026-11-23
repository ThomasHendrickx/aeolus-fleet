CREATE INDEX meetings_due_idx ON meetings (fleet_id, ends_at, id) WHERE ended_at IS NULL AND ends_at IS NOT NULL;
