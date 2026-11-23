UPDATE meeting_calls c SET closed_at = m.ended_at
FROM meetings m
WHERE c.fleet_id = m.fleet_id AND c.meeting_id = m.id
  AND c.closed_at IS NULL AND m.ended_at IS NOT NULL;
