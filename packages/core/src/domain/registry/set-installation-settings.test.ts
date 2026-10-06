import { beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import { createGetInstallationSettings } from './get-installation-settings.js';
import { createSetInstallationSettings, type SetInstallationSettings } from './set-installation-settings.js';

let core: InMemoryCore;
let setSettings: SetInstallationSettings;

beforeEach(() => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  setSettings = createSetInstallationSettings({ uow: core.uow });
});

describe("setting the installation's settings", () => {
  it('stores the default ship and daily message limits and the fleet cap, each a number or no limit', async () => {
    unwrap(await setSettings({ defaultShipLimit: 10, defaultDailyMessageLimit: null, fleetCap: 500 }));

    await expect(createGetInstallationSettings({ settings: core.installationSettings })()).resolves.toEqual({
      defaultShipLimit: 10,
      defaultDailyMessageLimit: null,
      fleetCap: 500,
    });
  });

  it.each([
    ['a negative limit', { defaultShipLimit: -1, defaultDailyMessageLimit: null, fleetCap: null }],
    ['a fractional limit', { defaultShipLimit: null, defaultDailyMessageLimit: 2.5, fleetCap: null }],
  ])('refuses %s and changes nothing', async (_case, settings) => {
    await expect(setSettings(settings)).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_LIMIT' } });
    await expect(createGetInstallationSettings({ settings: core.installationSettings })()).resolves.toEqual({
      defaultShipLimit: null,
      defaultDailyMessageLimit: null,
      fleetCap: null,
    });
  });
});
