import { parsePersonShipCursor } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { aPersonReadCrew, aPersonReadShip, PersonReadMemory, personReadShipId, PERSON_READ_LABEL, PERSON_READ_VALUE } from '../../../test/support/person-read-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import { createDiscoveryPage } from './discovery-page.js';

function aPagedDiscovery() {
  const core = new PersonReadMemory();
  core.ships.push(...Array.from({ length: 45 }, (_, index) => aPersonReadShip(index + 1, { name: index === 0 ? 'alpha' : index === 1 ? 'Alpha' : `ship-${String(index).padStart(2, '0')}` })));
  return { core, read: createDiscoveryPage({ uow: core.uow }), caller: aPersonReadCrew() };
}

describe('paged direct discovery', () => {
  it('continues three 20-row pages by folded name and id, with argo in name order and no unchanged overlap', async () => {
    // Given more than 40 destinations and a folded-name tie.
    const { read, caller } = aPagedDiscovery();

    // When the person explicitly loads each following page.
    const first = unwrap(await read(caller, {}));
    const second = unwrap(await read(caller, { cursor: first.nextCursor }));
    const third = unwrap(await read(caller, { cursor: second.nextCursor }));

    // Then the anchor is the last returned row, not the look-ahead row.
    expect([first.rows.length, second.rows.length, third.rows.length]).toEqual([20, 20, 6]);
    expect(first.rows.slice(0, 3).map(({ shipId }) => shipId)).toEqual([personReadShipId(1), personReadShipId(2), personReadShipId(91)]);
    expect(parsePersonShipCursor(first.nextCursor ?? '')?.after).toEqual({ name: 'ship-18', shipId: personReadShipId(19) });
    expect(new Set([...first.rows, ...second.rows, ...third.rows].map(({ shipId }) => shipId)).size).toBe(46);
    expect(third.nextCursor).toBeNull();
  });

  it('continues after a missing anchor with current rights instead of invalidating the cursor', async () => {
    // Given a first page before the anchor retires and send rights narrow.
    const { core, read, caller } = aPagedDiscovery();
    const first = unwrap(await read(caller, {}));
    core.rules = [{ verb: 'send', from: [], to: [PERSON_READ_VALUE] }];
    core.ships = core.ships.map((ship) => ship.id === personReadShipId(19) ? { ...ship, isActive: false }
      : ship.id === personReadShipId(26) ? { ...ship, labels: [{ labelId: PERSON_READ_LABEL, valueId: PERSON_READ_VALUE }] } : ship);

    // When the old cursor is continued under current rights.
    const second = unwrap(await read(caller, { cursor: first.nextCursor }));

    // Then only the still-authorized later destination is returned.
    expect(second.rows.map(({ shipId }) => shipId)).toEqual([personReadShipId(26)]);
    expect(second.nextCursor).toBeNull();
  });

  it('searches only the literal authorized first sentence and never the commission note or later sentences', async () => {
    // Given one crew summary and one unstated ship with a commission note.
    const core = new PersonReadMemory();
    core.ships.push(aPersonReadShip(1, { summary: '  Literal %_\\ description! Hidden detail.' }), aPersonReadShip(2, { commissionNote: 'Commission-only description' }));
    const read = createDiscoveryPage({ uow: core.uow });
    const caller = aPersonReadCrew();

    // When search is trimmed and uses literal wildcard characters.
    const found = unwrap(await read(caller, { search: '  %_\\  ' }));
    const hidden = unwrap(await read(caller, { search: 'hidden' }));
    const fallback = unwrap(await read(caller, { search: 'commission-only' }));

    // Then only the crew's first sentence can match.
    expect(found.rows).toEqual([{ shipId: personReadShipId(1), name: 'ship-01', kind: 'agent', description: 'Literal %_\\ description!' }]);
    expect([hidden.rows, fallback.rows]).toEqual([[], []]);
  });

  it('refuses a changed search or ended crew without commissioning, crewing or loading reports', async () => {
    // Given a usable messaging identity and an unavailable report service.
    const { core, read, caller } = aPagedDiscovery();
    core.hasReportFailure = true;
    const first = unwrap(await read(caller, {}));
    const before = core.ships.length;

    // When the query binding changes, then the existing crew ends.
    const changed = await read(caller, { search: 'different', cursor: first.nextCursor });
    core.ships = core.ships.map((ship) => ship.id === caller.shipId ? { ...ship, isCrewed: false } : ship);
    const ended = await read(caller, {});

    // Then neither failed read changes the ship population or acquires a crew.
    expect(refusalOf(changed).kind).toBe('INVALID_CURSOR');
    expect(refusalOf(ended).kind).toBe('LEASE_ENDED');
    expect(core.ships.length).toBe(before);
    expect(core.ships.find((ship) => ship.id === caller.shipId)?.isCrewed).toBe(false);
  });
});
