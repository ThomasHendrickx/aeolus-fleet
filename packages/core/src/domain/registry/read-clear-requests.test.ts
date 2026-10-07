import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: Caller;
let macMini: Caller;
let macStudio: Caller;
let scoutId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-07T15:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  macMini = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
  macStudio = await shipWithScopes({ registry, argo }, { name: 'mac-studio', type: 'trierarch', scopes: ['crew:run'] });
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  unwrap(await registry.requestWorktreeClear(argo, { trierarchShipId: macMini.shipId, shipId: scoutId, repository: 'aeolus-fleet' }));
  unwrap(await registry.requestWorktreeClear(argo, { trierarchShipId: macStudio.shipId, shipId: scoutId, repository: 'hemma' }));
});

describe('reading the pending clear requests (decision 0032)', () => {
  it('answers every trierarch\'s to a ship with fleet:read, so the console shows them clearing', async () => {
    const read = await registry.readClearRequests(argo);

    expect(read.map(({ trierarchShipId, repository }) => [trierarchShipId, repository])).toEqual(
      [
        [macMini.shipId, 'aeolus-fleet'],
        [macStudio.shipId, 'hemma'],
      ].sort(([first = ''], [second = '']) => first.localeCompare(second)),
    );
    expect(read[0]).toMatchObject({ shipId: scoutId, requestedBy: argo.shipId, requestedAt: core.clock.now() });
  });

  it('answers a trierarch with crew:run only its own', async () => {
    await expect(registry.readClearRequests(macMini)).resolves.toEqual([
      { trierarchShipId: macMini.shipId, shipId: scoutId, repository: 'aeolus-fleet', requestedBy: argo.shipId, requestedAt: core.clock.now() },
    ]);
  });
});
