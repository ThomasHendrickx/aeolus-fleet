-- The meeting list reads kept envelope facts, never retained message history.
ALTER TABLE meetings ADD COLUMN last_contribution_at timestamptz(3);
ALTER TABLE meeting_participants
  ADD COLUMN meeting_opened_at timestamptz(3),
  ADD COLUMN is_meeting_ended boolean NOT NULL DEFAULT false;
UPDATE meeting_participants p
  SET meeting_opened_at = m.opened_at, is_meeting_ended = m.ended_at IS NOT NULL
  FROM meetings m WHERE m.fleet_id = p.fleet_id AND m.id = p.meeting_id;
ALTER TABLE meeting_participants ALTER COLUMN meeting_opened_at SET NOT NULL;
UPDATE meetings m SET last_contribution_at = c.at
  FROM (SELECT fleet_id, meeting_id, max(created_at) AS at FROM messages
        WHERE meeting_id IS NOT NULL AND selector_kind = 'meeting'
        GROUP BY fleet_id, meeting_id) c
  WHERE c.fleet_id = m.fleet_id AND c.meeting_id = m.id;
CREATE INDEX meeting_participants_ship_list_idx
  ON meeting_participants (fleet_id, ship_id, is_meeting_ended, meeting_opened_at DESC, meeting_id DESC);
DROP INDEX meeting_participants_fleet_id_ship_id_idx;
