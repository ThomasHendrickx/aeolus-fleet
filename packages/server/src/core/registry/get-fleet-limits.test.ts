import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import { createGetFleetLimits, type GetFleetLimits } from './get-fleet-limits.js';
import { createSetInstallationSettings } from './set-installation-settings.js';

let core: InMemoryCore;
let getLimits: GetFleetLimits;
let fleetId: FleetId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  getLimits = createGetFleetLimits({ uow: core.uow });
  ({ fleetId } = await hostedFleet(core));
});

describe("reading a fleet's limits", () => {
  it('follows the installation defaults until set for the fleet, and none applies without a default', async () => {
    await expect(getLimits({ fleetId })).resolves.toEqual({
      isOk: true,
      value: { fleetId, ships: { setting: { kind: 'default' }, applies: null }, dailyMessages: { setting: { kind: 'default' }, applies: null } },
    });
  });

  it('follows a default as it changes', async () => {
    unwrap(await createSetInstallationSettings({ uow: core.uow })({ defaultShipLimit: 10, defaultDailyMessageLimit: 1000, fleetCap: null }));

    await expect(getLimits({ fleetId })).resolves.toMatchObject({ isOk: true, value: { ships: { applies: 10 }, dailyMessages: { applies: 1000 } } });
  });

  it('refuses a fleet the installation does not host', async () => {
    await expect(getLimits({ fleetId: core.ids('fleet') })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_NOT_FOUND' } });
  });
});
