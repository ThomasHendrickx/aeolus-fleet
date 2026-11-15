-- Plain messages use the same distinction as ackUpTo: every exchange message except conventions.
ALTER TABLE exchanges ADD COLUMN unseen_plain_messages INTEGER NOT NULL DEFAULT 0;

UPDATE exchanges e
SET unseen_plain_messages = counted.total
FROM (
  SELECT d.fleet_id, d.reached_ship_id AS ship_id, d.sender_ship_id AS other_ship_id, count(*)::int AS total
  FROM deliveries d
  JOIN messages m ON m.fleet_id = d.fleet_id AND m.id = d.message_id
  WHERE d.is_in_exchange AND d.reached_ship_id IS NOT NULL AND d.state IN ('pending', 'received', 'handed')
    AND lower(btrim(split_part(m.content_type, ';', 1))) NOT IN (
      'application/vnd.aeolus.question+json', 'application/vnd.aeolus.answer+json',
      'application/vnd.aeolus.question-withdrawal+json', 'application/vnd.aeolus.question-replacement+json',
      'application/vnd.aeolus.step+json', 'application/vnd.aeolus.step-outcome+json',
      'application/vnd.aeolus.step-withdrawal+json', 'application/vnd.aeolus.step-replacement+json',
      'application/vnd.aeolus.alert+json', 'application/vnd.aeolus.notice+json'
    )
  GROUP BY d.fleet_id, d.reached_ship_id, d.sender_ship_id
) counted
WHERE e.fleet_id = counted.fleet_id AND e.ship_id = counted.ship_id AND e.other_ship_id = counted.other_ship_id;
