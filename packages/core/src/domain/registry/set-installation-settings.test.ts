import { beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { createGetInstallationSettings } from './get-installation-settings.js';
import { createSetInstallationSettings, type SetInstallationSettings } from './set-installation-settings.js';

const NOTHING_SET = {
  defaultShipLimit: null,
  defaultDailyMessageLimit: null,
  defaultSchedulesPerShipLimit: null,
  defaultMinimumScheduleInterval: null,
  defaultRetentionDays: null,
  fleetCap: null,
};

let core: InMemoryCore;
let setSettings: SetInstallationSettings;

beforeEach(() => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  setSettings = createSetInstallationSettings({ uow: core.uow });
});

describe("setting the installation's settings", () => {
  it('stores the default ship, daily message and schedule limits, the default retention and the fleet cap, each a number or none', async () => {
    unwrap(
      await setSettings({ defaultShipLimit: 10, defaultDailyMessageLimit: null, defaultSchedulesPerShipLimit: 20, defaultMinimumScheduleInterval: 300, defaultRetentionDays: 30, fleetCap: 500 }),
    );

    await expect(createGetInstallationSettings({ settings: core.installationSettings })()).resolves.toEqual({
      defaultShipLimit: 10,
      defaultDailyMessageLimit: null,
      defaultSchedulesPerShipLimit: 20,
      defaultMinimumScheduleInterval: 300,
      defaultRetentionDays: 30,
      fleetCap: 500,
    });
  });

  it('takes a default retention of 1 day, the least there is', async () => {
    const settings = unwrap(await setSettings({ ...NOTHING_SET, defaultRetentionDays: 1 }));

    expect(settings.defaultRetentionDays).toBe(1);
  });

  it.each([
    ['a negative limit', { defaultShipLimit: -1, defaultDailyMessageLimit: null, defaultSchedulesPerShipLimit: null, defaultMinimumScheduleInterval: null, defaultRetentionDays: null, fleetCap: null }],
    ['a fractional limit', { defaultShipLimit: null, defaultDailyMessageLimit: 2.5, defaultSchedulesPerShipLimit: null, defaultMinimumScheduleInterval: null, defaultRetentionDays: null, fleetCap: null }],
    ['a negative schedules per ship limit', { defaultShipLimit: null, defaultDailyMessageLimit: null, defaultSchedulesPerShipLimit: -1, defaultMinimumScheduleInterval: null, defaultRetentionDays: null, fleetCap: null }],
    ['a fractional minimum schedule interval', { defaultShipLimit: null, defaultDailyMessageLimit: null, defaultSchedulesPerShipLimit: null, defaultMinimumScheduleInterval: 0.5, defaultRetentionDays: null, fleetCap: null }],
  ])('refuses %s and changes nothing', async (_case, settings) => {
    await expect(setSettings(settings)).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_LIMIT' } });
    await expect(createGetInstallationSettings({ settings: core.installationSettings })()).resolves.toEqual(NOTHING_SET);
  });

  it.each([
    ['a retention of 0 days', { ...NOTHING_SET, defaultRetentionDays: 0 }],
    ['a retention of part of a day', { ...NOTHING_SET, defaultRetentionDays: 1.5 }],
  ])('refuses %s and changes nothing', async (_case, settings) => {
    await expect(setSettings(settings)).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_RETENTION' } });
    await expect(createGetInstallationSettings({ settings: core.installationSettings })()).resolves.toEqual(NOTHING_SET);
  });
});
