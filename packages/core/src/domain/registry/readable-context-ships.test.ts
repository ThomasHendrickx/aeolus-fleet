import { describe, expect, it } from 'vitest';

import { aPersonReadAccount, aPersonReadShip, PersonReadMemory, personReadShipId, PERSON_READ_LABEL, PERSON_READ_VALUE } from '../../../test/support/person-read-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import { createReadableContextShips } from './readable-context-ships.js';

function aContextRead() {
  const core = new PersonReadMemory();
  core.ships.push(...Array.from({ length: 45 }, (_, index) => aPersonReadShip(index + 1)));
  return { core, read: createReadableContextShips({ uow: core.uow }), caller: aPersonReadAccount() };
}

describe('readable context outside the full current sendable set', () => {
  it('excludes destinations beyond the first messageable page, while retaining self and the viewer', async () => {
    // Given an account reading an open fleet and its person ship able to send.
    const { read, caller } = aContextRead();

    // When context is read without receiving any loaded discovery ids.
    const page = unwrap(await read(caller, {}));

    // Then every sendable destination is excluded, not just the first 20.
    expect(page.rows.map(({ shipId }) => shipId)).toEqual([personReadShipId(90), personReadShipId(92)]);
    expect(page.rows[1]?.report).toEqual({ status: 'read', state: 'idle', note: null, lastActivityAt: null });
    expect(page.nextCursor).toBeNull();
  });

  it('keeps send exclusion after the person crew ends, but removes it when stored send scope is lost', async () => {
    // Given the same active associated person ship, with no usable crew.
    const { core, read, caller } = aContextRead();
    core.ships = core.ships.map((ship) => ship.id === personReadShipId(90) ? { ...ship, isCrewed: false } : ship);
    const ended = unwrap(await read(caller, {}));

    // When its stored send scope is subsequently removed, under the same verified identity.
    core.ships = core.ships.map((ship) => ship.id === personReadShipId(90) ? { ...ship, scopes: ['fleet:read'] } : ship);
    const withoutSend = unwrap(await read(caller, {}));

    // Then ended crew alone never widens context, but absent send rights do.
    expect(ended.rows.map(({ shipId }) => shipId)).toEqual([personReadShipId(90), personReadShipId(92)]);
    expect(withoutSend.rows.length).toBe(20);
    expect(withoutSend.nextCursor).not.toBeNull();
  });

  it('enriches only the selected 20 rows and continues after retirement without an association change', async () => {
    // Given no active send scope and more than 40 readable rows.
    const { core, read, caller } = aContextRead();
    core.ships = core.ships.map((ship) => ship.id === personReadShipId(90) ? { ...ship, scopes: ['fleet:read'] } : ship);
    core.forbiddenReportIds.add(personReadShipId(19));

    // When a page uses a look-ahead row, then that anchor retires before continuation.
    const first = unwrap(await read(caller, {}));
    core.forbiddenReportIds.clear();
    core.ships = core.ships.map((ship) => ship.id === personReadShipId(18) ? { ...ship, isActive: false } : ship);
    const second = unwrap(await read(caller, { cursor: first.nextCursor }));

    // Then the read remains paged and only loaded rows have reports.
    expect([first.rows.length, second.rows.length]).toEqual([20, 20]);
    expect(first.rows.every(({ report }) => report.status === 'read')).toBe(true);
  });

  it('refuses missing account read scope rather than disguising it as an empty section', async () => {
    // Given a signed-in account without fleet:read.
    const { read, caller } = aContextRead();

    // When context is opened independently of discovery.
    const result = await read({ ...caller, scopes: [] }, {});

    // Then permission failure is distinct from a valid empty result.
    expect(refusalOf(result).kind).toBe('SCOPE_NOT_HELD');
  });

  it('keeps account read reach independent of the associated ship send reach', async () => {
    // Given closed send rules and account read reach to one ship.
    const { core, read, caller } = aContextRead();
    core.rules = [{ verb: 'read', from: [], to: [PERSON_READ_VALUE] }];
    core.ships = core.ships.map((ship) => ship.id === personReadShipId(30) ? { ...ship, owner: caller.personShipId }
      : ship.id === personReadShipId(31) ? { ...ship, labels: [{ labelId: PERSON_READ_LABEL, valueId: PERSON_READ_VALUE }] } : ship);

    // When context applies account owner reach and excludes current person sends.
    const page = unwrap(await read(caller, {}));

    // Then ownership also makes that ship sendable, so it never leaks into context.
    expect(page.rows.map(({ shipId }) => shipId)).toEqual([personReadShipId(90), personReadShipId(31)]);
  });
});
