ALTER TABLE deliveries ADD COLUMN acknowledged_by_event_id text;
CREATE INDEX deliveries_acknowledged_by_event_idx ON deliveries (fleet_id, acknowledged_by_event_id, id)
  WHERE acknowledged_by_event_id IS NOT NULL;
