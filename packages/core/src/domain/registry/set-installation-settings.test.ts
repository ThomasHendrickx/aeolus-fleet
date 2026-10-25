import { beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { createGetInstallationSettings } from './get-installation-settings.js';
import { createSetInstallationSettings, type SetInstallationSettings } from './set-installation-settings.js';

let core: InMemoryCore;
let setSettings: SetInstallationSettings;

beforeEach(() => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  setSettings = createSetInstallationSettings({ uow: core.uow });
});

describe("setting the installation's settings", () => {
  it('stores the default ship and daily message limits, the default retention and the fleet cap, each a number or none', async () => {
    unwrap(await setSettings({ defaultShipLimit: 10, defaultDailyMessageLimit: null, defaultRetentionDays: 30, fleetCap: 500 }));

    await expect(createGetInstallationSettings({ settings: core.installationSettings })()).resolves.toEqual({
      defaultShipLimit: 10,
      defaultDailyMessageLimit: null,
      defaultRetentionDays: 30,
      fleetCap: 500,
    });
  });

  it('takes a default retention of 1 day, the least there is', async () => {
    const settings = unwrap(await setSettings({ defaultShipLimit: null, defaultDailyMessageLimit: null, defaultRetentionDays: 1, fleetCap: null }));

    expect(settings.defaultRetentionDays).toBe(1);
  });

  it.each([
    ['a negative limit', 'INVALID_LIMIT', { defaultShipLimit: -1, defaultDailyMessageLimit: null, defaultRetentionDays: null, fleetCap: null }],
    ['a fractional limit', 'INVALID_LIMIT', { defaultShipLimit: null, defaultDailyMessageLimit: 2.5, defaultRetentionDays: null, fleetCap: null }],
    ['a retention of 0 days', 'INVALID_RETENTION', { defaultShipLimit: null, defaultDailyMessageLimit: null, defaultRetentionDays: 0, fleetCap: null }],
    ['a retention of part of a day', 'INVALID_RETENTION', { defaultShipLimit: null, defaultDailyMessageLimit: null, defaultRetentionDays: 1.5, fleetCap: null }],
  ])('refuses %s and changes nothing', async (_case, kind, settings) => {
    await expect(setSettings(settings)).resolves.toMatchObject({ isOk: false, error: { kind } });
    await expect(createGetInstallationSettings({ settings: core.installationSettings })()).resolves.toEqual({
      defaultShipLimit: null,
      defaultDailyMessageLimit: null,
      defaultRetentionDays: null,
      fleetCap: null,
    });
  });
});
