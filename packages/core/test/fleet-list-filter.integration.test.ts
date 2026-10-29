import type { ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ShipCaller } from '../src/domain/shared/caller.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { aCrewSettings, shipWithScopes } from './support/crew-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';

// The overview's filters, applied in the listing's statement on Postgres
// (decision 4 of the performance design): each selects the ships the
// domain's rule selects (domain/registry/ship-filter.ts), so a page holds
// only matches.

let core: PostgresCore;
let argo: ShipCaller;
let trierarchId: ShipId;

beforeAll(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  const commission = async (name: string, type: string) => unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type }));
  const plugin = await shipWithScopes({ registry: core.useCases, argo }, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
  const trierarch = await shipWithScopes({ registry: core.useCases, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
  trierarchId = trierarch.shipId;
  unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'alice', type: 'person', kind: 'person' }));
  const builder = await commission('builder', 'implementer');
  const byHand = await commission('by-hand', 'implementer');
  const crashed = await commission('crashed', 'tester');
  const crewing = await commission('crewing', 'tester');
  const old = await commission('old', 'reviewer');
  unwrap(await core.useCases.retireShip(argo, { shipId: old.shipId }));
  for (const shipId of [builder.shipId, byHand.shipId, crashed.shipId, crewing.shipId]) {
    unwrap(await core.useCases.requestCrew(argo, { shipId, settings: aCrewSettings() }));
  }
  unwrap(await core.useCases.claimShip({ shipId: byHand.shipId, secret: secretOf(byHand.secret), location: { kind: 'DEVICE' }, harness: 'codex' }));
  for (const shipId of [crashed.shipId, crewing.shipId]) {
    unwrap(await core.useCases.assignCrew(plugin, { shipId, trierarchShipId: trierarch.shipId }));
  }
  unwrap(await core.useCases.reportCrewStatus(trierarch, { shipId: crashed.shipId, status: 'crashed' }));
}, 120_000);

afterAll(async () => {
  await core.close();
});

async function namesSelected(input: Parameters<PostgresCore['useCases']['listFleet']>[1]): Promise<string[]> {
  return (await core.useCases.listFleet(argo, input)).ships.map((ship) => ship.name);
}

describe("fleet.list's filters on Postgres (decision 4 of the performance design)", () => {
  it('selects the ships whose crew request is assigned to a trierarch given, and none for a trierarch with none', async () => {
    expect([await namesSelected({ assignedTo: [trierarchId] }), await namesSelected({ assignedTo: [argo.shipId] })]).toEqual([['crashed', 'crewing'], []]);
  });

  it('selects the ships needing crew with the trierarch plugin connected or without it, as many as shipCounts counts', async () => {
    const counts = await core.useCases.countShips(argo);
    const counted = (plugin: 'withTrierarchs' | 'withoutTrierarchs') => counts.reduce((sum, kind) => sum + kind.needsCrew[plugin], 0);

    expect([
      await namesSelected({ needsCrew: 'withoutTrierarchs' }),
      await namesSelected({ needsCrew: 'withTrierarchs' }),
      counted('withoutTrierarchs'),
      counted('withTrierarchs'),
    ]).toEqual([['builder'], ['builder', 'crashed', 'crewing'], 1, 3]);
  });

  it('sorts the ships needing crew by when crew was requested, the oldest first', async () => {
    await expect(namesSelected({ needsCrew: 'withTrierarchs', sort: { column: 'requested', direction: 'ascending' } })).resolves.toEqual(['builder', 'crashed', 'crewing']);
  });

  it('counts the ships assigned to a trierarch as it lists them', async () => {
    const counts = await core.useCases.countShips(argo, { filter: { assignedTo: [trierarchId] } });

    expect(counts.reduce((sum, kind) => sum + kind.active, 0)).toBe(2);
  });

  it('selects the active ship of the exact name given, never one whose name only holds it, nor a retired one', async () => {
    expect([await namesSelected({ name: 'crewing' }), await namesSelected({ name: 'crew' }), await namesSelected({ name: 'old' })]).toEqual([['crewing'], [], []]);
  });

  it('selects the ships of any kind picked: argo and the person ships', async () => {
    await expect(namesSelected({ shipKind: ['operator', 'person'] })).resolves.toEqual(['argo', 'alice']);
  });

  it('selects the ships whose name or type holds the search text, in any case', async () => {
    await expect(namesSelected({ query: ' TEST ' })).resolves.toEqual(['crashed', 'crewing']);
  });

  it('selects the ships of any status picked: crewed counts argo, retired the retired ship', async () => {
    await expect(namesSelected({ status: ['crewed', 'retired'] })).resolves.toEqual(['argo', 'by-hand', 'old']);
  });

  it('answers the active ships only while the status filter asks for no retired ship', async () => {
    expect([await namesSelected({ type: ['reviewer'] }), await namesSelected({ type: ['reviewer'], status: ['retired'] })]).toEqual([[], ['old']]);
  });

  it('selects the ships of any type picked', async () => {
    await expect(namesSelected({ type: ['implementer', 'reviewer'] })).resolves.toEqual(['builder', 'by-hand']);
  });

  it.each([
    ['needsCrew', ['builder']],
    ['crewedByHand', ['by-hand']],
    ['crashed', ['crashed']],
    ['crewing', ['crewing']],
  ] as const)('selects the ships whose crew request stands at %s', async (key, names) => {
    await expect(namesSelected({ crewRequest: [key] })).resolves.toEqual(names);
  });

  it('selects the ships without a crew request', async () => {
    await expect(namesSelected({ crewRequest: ['none'] })).resolves.toEqual(['argo', 'alice', 'mac-mini', 'trierarch-plugin']);
  });

  it('combines the filters with AND, a page holding only matches', async () => {
    const page = await core.useCases.listFleet(argo, { type: ['implementer', 'tester'], status: ['awaitingCrew'], crewRequest: ['needsCrew', 'crashed'], limit: 1 });
    const next = await core.useCases.listFleet(argo, {
      type: ['implementer', 'tester'],
      status: ['awaitingCrew'],
      crewRequest: ['needsCrew', 'crashed'],
      cursor: page.nextCursor ?? undefined,
      limit: 1,
    });

    expect([page.ships.map((ship) => ship.name), next.ships.map((ship) => ship.name), next.nextCursor]).toEqual([['builder'], ['crashed'], null]);
  });
});
