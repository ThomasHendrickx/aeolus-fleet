CREATE INDEX events_meeting_read_up_to_idx ON events (fleet_id, occurred_at)
  WHERE type = 'MeetingReadUpTo';
