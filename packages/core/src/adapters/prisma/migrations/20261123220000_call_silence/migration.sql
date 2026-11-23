ALTER TABLE meeting_calls ADD COLUMN silent_ship_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN is_late BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX meeting_calls_due_idx ON meeting_calls(fleet_id, deadline, meeting_id) WHERE closed_at IS NULL;
