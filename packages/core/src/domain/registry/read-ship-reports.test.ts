import { describe, expect, it } from 'vitest';

import { aPersonReadAccount, aPersonReadShip, PersonReadMemory, personReadShipId, PERSON_READ_LABEL, PERSON_READ_VALUE } from '../../../test/support/person-read-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import { createReadShipReports } from './read-ship-reports.js';

describe('bounded account-authorized ship reports', () => {
  it('returns one result per requested id in order without distinguishing absent, retired and unreadable ships', async () => {
    // Given one readable active report and three unavailable ids.
    const core = new PersonReadMemory();
    core.rules = [{ verb: 'read', from: [], to: [PERSON_READ_VALUE] }];
    core.ships.push(aPersonReadShip(1, { labels: [{ labelId: PERSON_READ_LABEL, valueId: PERSON_READ_VALUE }], reportState: 'working', note: 'Building', lastActivityAt: '2026-11-10T10:00:00.000Z' }), aPersonReadShip(2), aPersonReadShip(3, { isActive: false }));
    const read = createReadShipReports({ uow: core.uow });
    const ids = [personReadShipId(2), personReadShipId(1), personReadShipId(3), personReadShipId(4)];

    // When the account asks for only these loaded ids.
    const result = unwrap(await read(aPersonReadAccount(), { shipIds: ids }));

    // Then only the authorized report is readable and request order is retained.
    expect(result.rows).toEqual([
      { shipId: ids[0], report: { status: 'unavailable' } },
      { shipId: ids[1], report: { status: 'read', state: 'working', note: 'Building', lastActivityAt: '2026-11-10T10:00:00.000Z' } },
      { shipId: ids[2], report: { status: 'unavailable' } },
      { shipId: ids[3], report: { status: 'unavailable' } },
    ]);
  });

  it('keeps a readable null report distinct from unavailable and applies alert precedence over awaiting crew', async () => {
    // Given readable ships with no report and an uncrewed ship with an alert.
    const core = new PersonReadMemory();
    core.ships.push(aPersonReadShip(1, { isCrewed: false }), aPersonReadShip(2, { isCrewed: false, hasOpenAlert: true }));
    const read = createReadShipReports({ uow: core.uow });

    // When the reports are projected in an open fleet.
    const result = unwrap(await read(aPersonReadAccount(), { shipIds: [personReadShipId(1), personReadShipId(2), personReadShipId(92)] }));

    // Then all three are read, including the always-crewed viewer without a lease.
    expect(result.rows.map(({ report }) => report)).toEqual([
      { status: 'read', state: 'awaitingCrew', note: null, lastActivityAt: null },
      { status: 'read', state: 'alert', note: null, lastActivityAt: null },
      { status: 'read', state: 'idle', note: null, lastActivityAt: null },
    ]);
  });

  it('returns an empty authorized batch without querying reports, but still refuses a missing read scope', async () => {
    // Given an unavailable report service and a valid account.
    const core = new PersonReadMemory();
    core.hasReportFailure = true;
    const read = createReadShipReports({ uow: core.uow });
    const caller = aPersonReadAccount();

    // When empty batches are requested with and without the scope.
    const empty = unwrap(await read(caller, { shipIds: [] }));
    const refused = await read({ ...caller, scopes: [] }, { shipIds: [] });

    // Then no report query is necessary, while permission failure remains explicit.
    expect(empty).toEqual({ rows: [] });
    expect(refusalOf(refused).kind).toBe('SCOPE_NOT_HELD');
  });
});
