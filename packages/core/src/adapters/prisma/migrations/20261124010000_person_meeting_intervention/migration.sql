ALTER TABLE meeting_calls ADD COLUMN not_asked_ship_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
