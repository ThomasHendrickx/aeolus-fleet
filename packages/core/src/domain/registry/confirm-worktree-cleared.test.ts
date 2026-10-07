import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: Caller;
let trierarch: Caller;
let scoutId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-07T15:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  trierarch = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  unwrap(await registry.requestWorktreeClear(argo, { trierarchShipId: trierarch.shipId, shipId: scoutId, repository: 'aeolus-fleet' }));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

describe('a trierarch confirming a clear request (decision 0032)', () => {
  it.each(['removed', 'not-kept'] as const)('makes the request disappear, with WorktreeCleared saying it was %s', async (outcome) => {
    await expect(registry.confirmWorktreeCleared(trierarch, { shipId: scoutId, repository: 'aeolus-fleet', outcome })).resolves.toEqual({ isOk: true, value: undefined });

    expect(core.state.clearRequests).toEqual([]);
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'WorktreeCleared',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: trierarch.shipId },
        shipId: trierarch.shipId,
        details: { worktreeShipId: scoutId, repository: 'aeolus-fleet', outcome },
      }),
    ]);
  });

  it("refuses a request the caller's ship does not hold: another trierarch's, or none", async () => {
    const other = await shipWithScopes({ registry, argo }, { name: 'mac-studio', type: 'trierarch', scopes: ['crew:run'] });

    const refused = refusalOf(await registry.confirmWorktreeCleared(other, { shipId: scoutId, repository: 'aeolus-fleet', outcome: 'removed' }));

    expect(refused).toEqual({ kind: 'CLEAR_REQUEST_NOT_FOUND', message: 'mac-studio holds no clear request for the aeolus-fleet worktree of scout' });
    expect(core.state.clearRequests).toHaveLength(1);
  });
});
