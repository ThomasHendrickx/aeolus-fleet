-- A compact projection survives finished message and lease retention. Its private
-- state holds only the first two crew ids, six achievements and at most 90 dates.
CREATE TABLE fleet_journeys (
  fleet_id text PRIMARY KEY REFERENCES fleets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at timestamptz(3) NOT NULL,
  coverage_from timestamptz(3) NOT NULL,
  processed_through bigint NOT NULL DEFAULT 0,
  activity_expires_at timestamptz(3),
  data jsonb
);
CREATE INDEX fleet_journeys_activity_expires_at_fleet_id_idx ON fleet_journeys(activity_expires_at, fleet_id);
CREATE INDEX fleet_journeys_created_at_fleet_id_idx ON fleet_journeys(created_at, fleet_id);

-- Installation-owned synchronization records, not customer data. The resource
-- reference survives deletion as a tombstone so an offline consumer can catch up.
CREATE TABLE installation_journey_clock (id integer PRIMARY KEY CHECK (id = 1), seq bigint NOT NULL);
INSERT INTO installation_journey_clock VALUES (1, 0);
CREATE TABLE installation_journey_changes (
  resource_id text PRIMARY KEY,
  seq bigint NOT NULL UNIQUE,
  is_deleted boolean NOT NULL
);

-- Older evidence is incomplete until proved, never reported as not-yet.
INSERT INTO fleet_journeys(fleet_id, created_at, coverage_from, processed_through)
SELECT id, created_at, CURRENT_TIMESTAMP, last_event_seq FROM fleets WHERE deleted_at IS NULL;
INSERT INTO installation_journey_changes(resource_id, seq, is_deleted)
SELECT fleet_id, row_number() OVER (ORDER BY created_at, fleet_id), false FROM fleet_journeys;
UPDATE installation_journey_clock SET seq = (SELECT count(*) FROM installation_journey_changes);

-- Qualification at acceptance is metadata, retained with its delivery. Reply
-- lookup is through deliveries' existing (fleet_id, message_id) index.
ALTER TABLE deliveries ADD COLUMN journey_qualifying boolean;
ALTER TABLE deliveries ADD COLUMN journey_both_crewed boolean;

-- One historical crew interval at a send time, not every lease of that ship.
CREATE INDEX leases_fleet_id_ship_id_started_at_id_idx ON leases(fleet_id, ship_id, started_at, id);
