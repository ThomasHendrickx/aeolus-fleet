import { CLEAR_REQUESTS_PER_TRIERARCH_MAX, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let trierarch: Caller;
let scoutId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-07T15:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  trierarch = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  core.state.events.length = 0;
});

describe('requesting that a trierarch clear a kept worktree (decision 0032)', () => {
  it('stores the request: the trierarch, the worktree by its ship and repository, who asked and when', async () => {
    await expect(registry.requestWorktreeClear(argo, { trierarchShipId: trierarch.shipId, shipId: scoutId, repository: 'aeolus-fleet' })).resolves.toEqual({
      isOk: true,
      value: undefined,
    });

    expect(core.state.clearRequests).toEqual([
      { fleetId, trierarchShipId: trierarch.shipId, shipId: scoutId, repository: 'aeolus-fleet', requestedBy: argo.shipId, requestedAt: core.clock.now() },
    ]);
  });

  it("writes WorktreeClearRequested on the trierarch's ship, caused by the requester, naming the worktree by ship and repository", async () => {
    unwrap(await registry.requestWorktreeClear(argo, { trierarchShipId: trierarch.shipId, shipId: scoutId, repository: 'aeolus-fleet' }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'WorktreeClearRequested',
        actor: { kind: 'ship', shipId: argo.shipId },
        shipId: trierarch.shipId,
        details: { worktreeShipId: scoutId, repository: 'aeolus-fleet' },
      }),
    ]);
  });

  it('changes nothing for a request it holds already', async () => {
    unwrap(await registry.requestWorktreeClear(argo, { trierarchShipId: trierarch.shipId, shipId: scoutId, repository: 'aeolus-fleet' }));
    core.state.events.length = 0;
    core.clock.advance(60_000);

    unwrap(await registry.requestWorktreeClear(argo, { trierarchShipId: trierarch.shipId, shipId: scoutId, repository: 'aeolus-fleet' }));

    expect(core.state.clearRequests).toHaveLength(1);
    expect(core.state.events).toEqual([]);
  });

  it('refuses a ship that is not a trierarch, naming it', async () => {
    const refused = refusalOf(await registry.requestWorktreeClear(argo, { trierarchShipId: scoutId, shipId: scoutId, repository: 'aeolus-fleet' }));

    expect(refused).toEqual({ kind: 'NOT_A_TRIERARCH', message: 'scout is no trierarch: only a trierarch clears a worktree it kept' });
    expect(core.state.clearRequests).toEqual([]);
  });

  it('refuses a retired trierarch', async () => {
    unwrap(await registry.retireShip(argo, { shipId: trierarch.shipId }));

    await expect(registry.requestWorktreeClear(argo, { trierarchShipId: trierarch.shipId, shipId: scoutId, repository: 'aeolus-fleet' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_ALREADY_RETIRED' },
    });
  });

  it('refuses a trierarch or a worktree ship the fleet does not have', async () => {
    await expect(registry.requestWorktreeClear(argo, { trierarchShipId: core.ids('ship'), shipId: scoutId, repository: 'aeolus-fleet' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
    await expect(registry.requestWorktreeClear(argo, { trierarchShipId: trierarch.shipId, shipId: core.ids('ship'), repository: 'aeolus-fleet' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });

  it('takes the most pending requests a trierarch may hold, and refuses one more, naming the decision', async () => {
    for (let index = 0; index < CLEAR_REQUESTS_PER_TRIERARCH_MAX; index += 1) {
      unwrap(await registry.requestWorktreeClear(argo, { trierarchShipId: trierarch.shipId, shipId: scoutId, repository: `repository-${String(index)}` }));
    }

    const refused = refusalOf(await registry.requestWorktreeClear(argo, { trierarchShipId: trierarch.shipId, shipId: scoutId, repository: 'one-more' }));

    expect(refused.kind).toBe('CLEAR_REQUEST_LIMIT_REACHED');
    expect(refused.message).toContain('decision 0032');
    expect(core.state.clearRequests).toHaveLength(CLEAR_REQUESTS_PER_TRIERARCH_MAX);
  });
});
