import { idSchema, type PersonShipCursorRecord, personShipCursorOf, parsePersonShipCursor } from '@aeolus-fleet/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaPersonReadUnitOfWork } from '../src/adapters/prisma/person-read-unit-of-work.js';
import { createPrismaPersonShipReadTx } from '../src/adapters/prisma/person-ship-reads.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { actorAsItIs } from '../src/domain/registry/check-reach.js';
import { ok } from '../src/domain/shared/result.js';
import { newKey } from '../src/testing/keys.js';
import { refusalOf, unwrap } from '../src/testing/result.js';
import { aPersonReadFleet, personReadsOf, personReadUow } from './support/person-read-postgres.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

let core: PostgresCore;
let fleet: Awaited<ReturnType<typeof aPersonReadFleet>>;
beforeAll(async () => { core = await createPostgresCore(); });
beforeEach(async () => {
  core.clock.set('2026-11-10T10:00:00.000Z');
  fleet = await aPersonReadFleet(core);
});
afterAll(async () => { await core.close(); });

async function fortyFiveShips() {
  const ships = [];
  for (let number = 1; number <= 45; number += 1) {
    ships.push(await fleet.crew({ name: `ship-${String(number).padStart(2, '0')}` }));
  }
  return ships;
}

describe('person ship reads through PostgreSQL', () => {
  it('pages more than 40 destinations once by folded name/id, and excludes the full sendable set from context', async () => {
    // Given an open fleet with more than two pages of messageable ships.
    const [firstShip, secondShip] = await fortyFiveShips();
    if (firstShip === undefined || secondShip === undefined) {
      throw new Error('The fixture must contain both folded-name ties');
    }
    await core.prisma.$executeRaw`UPDATE ships SET name = CASE WHEN id = ${firstShip.shipId} THEN ${'alpha'} ELSE ${'Alpha'} END WHERE fleet_id = ${fleet.fleetId} AND id = ANY(${[firstShip.shipId, secondShip.shipId]}::text[])`;

    // When each section reads independently and discovery continues explicitly.
    const first = unwrap(await fleet.reads.discoveryPage(fleet.person.crew, {}));
    const second = unwrap(await fleet.reads.discoveryPage(fleet.person.crew, { cursor: first.nextCursor }));
    const third = unwrap(await fleet.reads.discoveryPage(fleet.person.crew, { cursor: second.nextCursor }));
    const context = unwrap(await fleet.reads.readableContextShips(fleet.account(), {}));

    // Then the page boundary is 20, argo sorts by name, and no later discovery row leaks into context.
    expect([first.rows.length, second.rows.length, third.rows.length]).toEqual([20, 20, 6]);
    expect(first.rows.slice(0, 3).map(({ shipId }) => shipId)).toEqual([firstShip.shipId, secondShip.shipId, fleet.argo.shipId]);
    expect(new Set([...first.rows, ...second.rows, ...third.rows].map(({ shipId }) => shipId)).size).toBe(46);
    expect(third.nextCursor).toBeNull();
    expect(context.rows.map(({ name }) => name)).toEqual(['person-one', 'viewer']);
    expect(context.rows.find(({ name }) => name === 'viewer')?.report).toEqual({ status: 'read', state: 'idle', note: null, lastActivityAt: null });
  });

  it('uses literal short and trigram searches over authorized first sentences only, with no commission fallback', async () => {
    // Given one authorized statement and both unauthorized and later hidden text.
    const visible = await fleet.crew({ name: 'visible', note: 'Commission fallback must stay hidden' });
    const hidden = await fleet.crew({ name: 'hidden' });
    const unstated = await fleet.crew({ name: 'unstated', note: 'Commission fallback must stay hidden' });
    unwrap(await core.useCases.setStatement(visible.crew, { summary: '  Καλημέρα literal %_\\ sentence! HiddenOnly.', capabilities: [] }));
    unwrap(await core.useCases.setStatement(hidden.crew, { summary: 'HiddenOnly.', capabilities: [] }));
    const allowed = await fleet.label('audience');
    unwrap(await core.useCases.assignLabel(fleet.argo, { shipId: visible.shipId, valueId: allowed }));
    unwrap(await core.useCases.assignLabel(fleet.argo, { shipId: unstated.shipId, valueId: allowed }));
    await fleet.setRules([{ verb: 'send', from: [], to: [allowed] }]);

    // When blank, one/two-character and selective searches use the same authorized projection.
    for (const search of ['%', '_', '\\', '%_\\', '  LITERAL  ', 'Καλημέρα', 'li', 'l']) {
      const page = unwrap(await fleet.reads.discoveryPage(fleet.person.crew, { search }));
      expect(page.rows.map(({ shipId }) => shipId), search).toEqual([visible.shipId]);
      expect(page.rows[0]?.description).toBe('Καλημέρα literal %_\\ sentence!');
    }
    const hiddenResult = unwrap(await fleet.reads.discoveryPage(fleet.person.crew, { search: 'HiddenOnly' }));
    const fallback = unwrap(await fleet.reads.discoveryPage(fleet.person.crew, { search: 'Commission fallback' }));
    const refresh = unwrap(await fleet.reads.discoveryPage(fleet.person.crew, { shipIds: [unstated.shipId] }));

    // Then hidden text cannot cause a match, while an unstated authorized row stays null.
    expect([hiddenResult.rows, fallback.rows]).toEqual([[], []]);
    expect(refresh.rows[0]?.description).toBeNull();
    expect(refresh.nextCursor).toBeNull();
  });

  it('binds cursors to fleet, section, actor, association and normalized search, while continuing from a retired anchor', async () => {
    // Given a real first page and its opaque continuation.
    await fortyFiveShips();
    const first = unwrap(await fleet.reads.discoveryPage(fleet.person.crew, {}));
    const record = parsePersonShipCursor(first.nextCursor ?? '');
    if (record === undefined) {
      throw new Error('The first page must have a cursor');
    }
    const mismatches: Partial<PersonShipCursorRecord>[] = [
      { fleetId: idSchema('fleet').parse('flt_00000000000000000000000002') },
      { section: 'readableContext' }, { search: 'other' },
      { actor: { kind: 'ship', id: fleet.argo.shipId } }, { associatedShipId: null },
    ];

    // When any binding is changed, it is refused; ordinary current-rights changes are not a binding.
    for (const mismatch of mismatches) {
      const result = await fleet.reads.discoveryPage(fleet.person.crew, { cursor: personShipCursorOf({ ...record, ...mismatch }) });
      expect(refusalOf(result).kind).toBe('INVALID_CURSOR');
    }
    unwrap(await core.useCases.retireShip(fleet.argo, { shipId: record.after.shipId }));
    const second = unwrap(await fleet.reads.discoveryPage(fleet.person.crew, { cursor: first.nextCursor }));

    // Then the old key works without looking up the missing anchor.
    expect(second.rows.length).toBe(20);
    expect(second.rows.some(({ shipId }) => shipId === record.after.shipId)).toBe(false);
  });

  it('keeps account groups and stored person send labels separate when composing context and reports', async () => {
    // Given an account in engineering and its person ship carrying finance instead.
    const group = unwrap(await core.useCases.defineLabel(fleet.argo, { key: 'group', values: ['engineering', 'finance'] }));
    const engineering = group.values.find(({ value }) => value === 'engineering');
    const finance = group.values.find(({ value }) => value === 'finance');
    if (engineering === undefined || finance === undefined) {
      throw new Error('The fixture groups must exist');
    }
    const readable = await fleet.crew({ name: 'engineering-target' });
    const messageable = await fleet.crew({ name: 'finance-target' });
    for (const shipId of [fleet.person.shipId, messageable.shipId]) {
      unwrap(await core.useCases.assignLabel(fleet.argo, { shipId, valueId: finance.id }));
    }
    unwrap(await core.useCases.assignLabel(fleet.argo, { shipId: readable.shipId, valueId: engineering.id }));
    await fleet.setRules([{ verb: 'read', from: [engineering.id], to: [engineering.id] }, { verb: 'send', from: [finance.id], to: [finance.id] }]);
    const account = fleet.account({ groupValues: ['engineering', 'unknown'], throughShipId: messageable.shipId });

    // When the two subjects' current rights are evaluated in the same context snapshot.
    const discovery = unwrap(await fleet.reads.discoveryPage(fleet.person.crew, {}));
    const context = unwrap(await fleet.reads.readableContextShips(account, {}));
    const reports = unwrap(await fleet.reads.shipReports(account, { shipIds: [messageable.shipId, readable.shipId] }));

    // Then discovery never grants a report and the presenting ship never supplies account read rights.
    expect(discovery.rows.map(({ name }) => name)).toEqual(['argo', 'finance-target']);
    expect(context.rows.map(({ name }) => name)).toEqual(['engineering-target', 'person-one']);
    expect(reports.rows.map(({ report }) => report.status)).toEqual(['unavailable', 'read']);
  });

  it('returns ordered unavailable reports without reasons and uses latest event sequence plus lease activity', async () => {
    // Given one readable report, one hidden ship and one retired ship.
    const shown = await fleet.crew({ name: 'shown' });
    const hidden = await fleet.crew({ name: 'hidden' });
    const retired = await fleet.crew({ name: 'retired' });
    const allowed = await fleet.label('readable');
    unwrap(await core.useCases.assignLabel(fleet.argo, { shipId: shown.shipId, valueId: allowed }));
    await fleet.setRules([{ verb: 'read', from: [], to: [allowed] }]);
    unwrap(await core.useCases.retireShip(fleet.argo, { shipId: retired.shipId }));
    core.clock.set('2026-11-10T10:05:00.000Z');
    unwrap(await core.useCases.sendMessage(shown.crew, { selector: { kind: 'ship', name: 'argo' }, payload: 'first', idempotencyKey: newKey(), model: 'gpt-6.1-sol' }));
    core.clock.set('2026-11-10T10:02:00.000Z');
    unwrap(await core.useCases.sendMessage(shown.crew, { selector: { kind: 'ship', name: 'argo' }, payload: 'second', idempotencyKey: newKey(), model: 'gpt-6.1-sol' }));
    await core.prisma.$executeRaw`UPDATE leases SET activity_at = NULL WHERE fleet_id = ${fleet.fleetId} AND ship_id = ${shown.shipId} AND ended_at IS NULL`;
    const missing = idSchema('ship').parse('shp_00000000000000000000000009');

    // When only the concerned ids are enriched under account read reach.
    const result = unwrap(await fleet.reads.shipReports(fleet.account(), { shipIds: [hidden.shipId, shown.shipId, missing, retired.shipId] }));
    await core.prisma.$executeRaw`UPDATE leases SET activity_at = '2026-11-10T10:03:00.000Z' WHERE fleet_id = ${fleet.fleetId} AND ship_id = ${shown.shipId} AND ended_at IS NULL`;
    const laterLease = unwrap(await fleet.reads.shipReports(fleet.account(), { shipIds: [shown.shipId] }));

    // Then newest sequence wins over max timestamp, and unknown/unreadable/retired are indistinguishable.
    expect(result.rows).toEqual([
      { shipId: hidden.shipId, report: { status: 'unavailable' } },
      { shipId: shown.shipId, report: { status: 'read', state: 'idle', note: null, lastActivityAt: '2026-11-10T10:02:00.000Z' } },
      { shipId: missing, report: { status: 'unavailable' } },
      { shipId: retired.shipId, report: { status: 'unavailable' } },
    ]);
    expect(laterLease.rows[0]?.report).toEqual({ status: 'read', state: 'idle', note: null, lastActivityAt: '2026-11-10T10:03:00.000Z' });
  });

  it.each(['retired', 'removed', 'unknown', 'otherFleet'] as const)('preserves existing account owner facts for a %s association while send exclusion is empty', async (state) => {
    // Given a stored or absent association and a rule explicitly naming its selected owner.
    let association = fleet.person.shipId;
    if (state === 'unknown') {
      association = idSchema('ship').parse('shp_00000000000000000000000010');
    } else if (state === 'otherFleet') {
      association = (await aPersonReadFleet(core)).person.shipId;
    } else {
      unwrap(await core.useCases.retireShip(fleet.argo, { shipId: association }));
      if (state === 'removed') {
        await core.prisma.$executeRaw`UPDATE ships SET removed_at = now(), owner_ship_id = NULL, scopes = '{}' WHERE fleet_id = ${fleet.fleetId} AND id = ${association}`;
      }
    }
    await fleet.setRules([{ verb: 'read', from: [{ owner: association }], to: [] }]);
    const caller = fleet.account({ personShipId: association });

    // When the new snapshot resolves its actor facts beside the existing checker.
    const facts = unwrap(await personReadUow(core).run(fleet.fleetId, async (tx) => ok(await tx.facts.find(caller))));
    const existing = unwrap(await createPrismaUnitOfWork(core.prisma).run(async (tx) => ok(await actorAsItIs(tx, caller))));
    const page = unwrap(await fleet.reads.readableContextShips(caller, {}));

    // Then account owner terms retain existing semantics, independent of send eligibility.
    expect(facts.reader).toEqual(existing?.reaching);
    expect(facts.sender).toBeNull();
    expect(page.rows.some(({ name }) => name === 'argo')).toBe(state === 'retired' || state === 'removed');
  });

  it('keeps scope, labels, statement and report coherent when writers commit after actor facts are read', async () => {
    // Given a readable target and a ship reader with no direct send rule to it.
    const reader = await fleet.crew({ name: 'reader', scopes: ['fleet:read'] });
    const target = await fleet.crew({ name: 'target' });
    const allowed = await fleet.label('snapshot');
    unwrap(await core.useCases.assignLabel(fleet.argo, { shipId: target.shipId, valueId: allowed }));
    unwrap(await core.useCases.setStatement(target.crew, { summary: 'Old description.', capabilities: [] }));
    unwrap(await core.useCases.report(target.crew, { state: 'working', note: 'Old report' }));
    await fleet.setRules([{ verb: 'read', from: [], to: [allowed] }]);
    const loaded = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const held = createPrismaPersonReadUnitOfWork({ prisma: core.prisma, portsOf: (connection) => {
      const tx = createPrismaPersonShipReadTx({ connection });
      return { ...tx, facts: { find: async (caller) => {
        const facts = await tx.facts.find(caller);
        loaded.resolve();
        await resume.promise;
        return facts;
      } } };
    } });
    const pending = personReadsOf(held).readableContextShips(reader.crew, { search: 'target' });
    await loaded.promise;

    // When independent valid writers change all those facts after the snapshot began.
    try {
      unwrap(await core.useCases.grantScopes(fleet.argo, { shipId: reader.shipId, grant: [], revoke: ['fleet:read'] }));
      unwrap(await core.useCases.unassignLabel(fleet.argo, { shipId: target.shipId, valueId: allowed }));
      unwrap(await core.useCases.setStatement(target.crew, { summary: 'New description.', capabilities: [] }));
      unwrap(await core.useCases.report(target.crew, { state: 'idle', note: 'New report' }));
    } finally {
      resume.resolve();
    }
    const page = unwrap(await pending);
    const next = await fleet.reads.readableContextShips(reader.crew, { search: 'target' });

    // Then the old read sees one moment; the next read enforces the lost scope.
    expect(page.rows).toEqual([{ shipId: target.shipId, name: 'target', kind: 'agent', description: 'Old description.', report: { status: 'read', state: 'working', note: 'Old report', lastActivityAt: null } }]);
    expect(refusalOf(next).kind).toBe('SCOPE_NOT_HELD');
  });
});
