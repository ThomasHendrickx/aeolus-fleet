CREATE TABLE commission_approvals (
  id TEXT PRIMARY KEY,
  fleet_id TEXT NOT NULL REFERENCES fleets(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  approver JSONB NOT NULL,
  commissioner_id TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  subject_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL,
  withdrawn_at TIMESTAMPTZ(3),
  UNIQUE (fleet_id, id),
  FOREIGN KEY (fleet_id, commissioner_id) REFERENCES ships(fleet_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (ships_scopes_are_known(scopes)),
  CHECK (length(subject_digest) > 0)
);

CREATE INDEX commission_approvals_fleet_id_commissioner_id_idx ON commission_approvals(fleet_id, commissioner_id);
