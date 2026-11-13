import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { createReadLastNamedOwner, type ReadLastNamedOwner } from './read-last-named-owner.js';

const MINUTE_MS = 60 * 1000;

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let argoInConsole: ShipCaller;
let readLastNamedOwner: ReadLastNamedOwner;

beforeEach(async () => {
  core = createInMemoryCore('2026-11-13T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  argoInConsole = { ...argo, consoleSessionId: core.ids('consoleSession') };
  registry = registryUseCases(core);
  readLastNamedOwner = createReadLastNamedOwner({ ships: core.ships });
});

async function personShip(name: string): Promise<ShipId> {
  return unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'person', kind: 'person' })).shipId;
}

async function commissionOwnedBy(name: string, owner: ShipId): Promise<void> {
  core.clock.advance(MINUTE_MS);
  unwrap(await registry.commissionShip(argoInConsole, { idempotencyKey: newKey(), name, type: 'reviewer', owner }));
}

describe('the owner argo named last, preselected when it commissions from the console (#1777, S2)', () => {
  it('is the person ship argo named at its last commission', async () => {
    const charlotte = await personShip('charlotte');
    const burak = await personShip('burak');
    await commissionOwnedBy('reviewer-01', charlotte);
    await commissionOwnedBy('reviewer-02', burak);

    const owner = await readLastNamedOwner(argoInConsole);

    expect(owner).toEqual({ id: burak, name: 'burak' });
  });

  it('is none before argo named an owner', async () => {
    await personShip('charlotte');

    const owner = await readLastNamedOwner(argoInConsole);

    expect(owner).toBeNull();
  });

  it('is none when the person ship argo named last is retired', async () => {
    const charlotte = await personShip('charlotte');
    await commissionOwnedBy('reviewer-01', charlotte);
    unwrap(await registry.retireShip(argo, { shipId: charlotte }));

    const owner = await readLastNamedOwner(argoInConsole);

    expect(owner).toBeNull();
  });
});
