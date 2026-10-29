import { SCOPES, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet, sealFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { DATA_KEY_CACHE_MS } from './data-keys.js';
import { createReadSealing, type ReadSealing } from './read-sealing.js';

let core: InMemoryCore;
let readSealing: ReadSealing;
let fleetId: FleetId;
let argo: ShipCaller;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-29T12:00:00.000Z');
  readSealing = createReadSealing({ sealings: core.sealings });
  let operatorShipId: ShipId;
  ({ fleetId, operatorShipId } = await hostedFleet(core));
  argo = { shipId: operatorShipId, fleetId, kind: 'operator', scopes: [...SCOPES] };
});

describe("reading a fleet's sealing (decision 0068, B5, B11)", () => {
  it('reads none for a fleet that is not sealed', async () => {
    expect(await readSealing(argo)).toEqual({ state: 'none' });
  });

  it("reads the state, the company key reference, the key's availability since when and the data keys' ages, never a key", async () => {
    const companyKey = await sealFleet(core, fleetId);
    const [dataKey] = core.state.dataKeys;

    const sealing = await readSealing(argo);

    expect(sealing).toEqual({
      state: 'sealed',
      companyKey,
      keyAvailability: { isAvailable: true, since: new Date('2026-10-29T12:00:00.000Z') },
      dataKeys: [{ id: dataKey?.id, createdAt: new Date('2026-10-29T12:00:00.000Z'), isCurrent: true }],
    });
  });

  it('reads the company key unavailable with the key vault reason, since its first refusal', async () => {
    const companyKey = await sealFleet(core, fleetId);
    const [dataKey] = core.state.dataKeys;
    await core.keyVault.refuseGrant(companyKey);
    core.clock.advance(DATA_KEY_CACHE_MS);
    refusalOf(await core.sealing.dataKeys.unwrap(fleetId, [dataKey?.id ?? core.ids('dataKey')]));

    const sealing = await readSealing(argo);

    expect(sealing).toMatchObject({ keyAvailability: { isAvailable: false, reason: 'accessDenied', since: new Date('2026-10-29T12:05:00.000Z') } });
  });
});
