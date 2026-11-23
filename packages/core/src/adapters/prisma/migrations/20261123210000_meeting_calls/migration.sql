ALTER TABLE meetings ADD COLUMN end_after_calls INTEGER CHECK (end_after_calls > 0);
ALTER TABLE messages ADD COLUMN call_id TEXT;
CREATE TABLE meeting_calls (
  id TEXT PRIMARY KEY,
  fleet_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expected_ship_ids TEXT[] NOT NULL,
  deadline TIMESTAMPTZ(3) NOT NULL,
  opened_at TIMESTAMPTZ(3) NOT NULL,
  closed_at TIMESTAMPTZ(3),
  answers JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT meeting_calls_fleet_id_meeting_id_fkey FOREIGN KEY (fleet_id, meeting_id) REFERENCES meetings(fleet_id, id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX meeting_calls_fleet_id_id_key ON meeting_calls(fleet_id, id);
CREATE INDEX meeting_calls_fleet_id_meeting_id_id_idx ON meeting_calls(fleet_id, meeting_id, id);
CREATE UNIQUE INDEX meeting_calls_one_open_idx ON meeting_calls(fleet_id, meeting_id) WHERE closed_at IS NULL;
CREATE INDEX meeting_calls_closed_idx ON meeting_calls(fleet_id, meeting_id) WHERE closed_at IS NOT NULL;
