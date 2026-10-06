import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Caller;

beforeEach(async () => {
  core = createInMemoryCore();
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  useCases = registryUseCases(core);
});

describe('who am I', () => {
  it('tells a crewed ship its id, fleet, name and type', async () => {
    const { shipId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const scout: Caller = { shipId, fleetId, kind: 'agent', scopes: ['messages:send', 'messages:receive'] };

    await expect(useCases.whoami(scout)).resolves.toEqual({
      isOk: true,
      value: { shipId, fleetId, name: 'scout', type: 'reviewer' },
    });
  });

  it('tells argo who it is', async () => {
    await expect(useCases.whoami(argo)).resolves.toEqual({
      isOk: true,
      value: { shipId: argoId, fleetId, name: 'argo', type: 'operator' },
    });
  });

  it("refuses a ship the caller's fleet does not have", async () => {
    const stranger: Caller = { ...argo, fleetId: core.ids('fleet') };

    await expect(useCases.whoami(stranger)).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_FOUND' } });
  });
});
