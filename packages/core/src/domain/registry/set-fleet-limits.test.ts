import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { createGetFleetLimits } from './get-fleet-limits.js';
import { createSetFleetLimits, type SetFleetLimits } from './set-fleet-limits.js';
import { createSetInstallationSettings } from './set-installation-settings.js';

let core: InMemoryCore;
let setLimits: SetFleetLimits;
let fleetId: FleetId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  setLimits = createSetFleetLimits({ uow: core.uow, clock: core.clock, ids: core.ids });
  ({ fleetId } = await hostedFleet(core));
  unwrap(await createSetInstallationSettings({ uow: core.uow })({ defaultShipLimit: 10, defaultDailyMessageLimit: 1000, defaultRetentionDays: 30, fleetCap: null }));
  core.state.events.length = 0;
});

describe("setting a fleet's limits", () => {
  it('sets one limit for the fleet, to a number or to no limit, and leaves the other following the default', async () => {
    const limits = unwrap(await setLimits({ fleetId, ships: { kind: 'fleet', limit: 25 } }));

    expect(limits).toEqual({
      fleetId,
      ships: { setting: { kind: 'fleet', limit: 25 }, applies: 25 },
      dailyMessages: { setting: { kind: 'default' }, applies: 1000 },
      retention: { setting: { kind: 'default' }, applies: 30 },
    });
    unwrap(await setLimits({ fleetId, dailyMessages: { kind: 'fleet', limit: null } }));
    await expect(createGetFleetLimits({ uow: core.uow })({ fleetId })).resolves.toMatchObject({
      isOk: true,
      value: { dailyMessages: { setting: { kind: 'fleet', limit: null }, applies: null } },
    });
  });

  it("sets the fleet's own retention, a number of days or none, and back to the default", async () => {
    expect(unwrap(await setLimits({ fleetId, retention: { kind: 'fleet', days: 7 } })).retention).toEqual({ setting: { kind: 'fleet', days: 7 }, applies: 7 });
    expect(unwrap(await setLimits({ fleetId, retention: { kind: 'fleet', days: null } })).retention).toEqual({ setting: { kind: 'fleet', days: null }, applies: null });
    expect(unwrap(await setLimits({ fleetId, retention: { kind: 'default' } })).retention).toEqual({ setting: { kind: 'default' }, applies: 30 });
  });

  it('takes a retention of 1 day, the least there is', async () => {
    expect(unwrap(await setLimits({ fleetId, retention: { kind: 'fleet', days: 1 } })).retention.applies).toBe(1);
  });

  it('resets a limit to follow the installation default again', async () => {
    unwrap(await setLimits({ fleetId, ships: { kind: 'fleet', limit: 25 } }));

    const limits = unwrap(await setLimits({ fleetId, ships: { kind: 'default' } }));

    expect(limits.ships).toEqual({ setting: { kind: 'default' }, applies: 10 });
  });

  it('writes FleetLimitsChanged in the fleet, with the settings it now has', async () => {
    unwrap(await setLimits({ fleetId, ships: { kind: 'fleet', limit: 25 } }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        fleetId,
        type: 'FleetLimitsChanged',
        actor: { kind: 'system' },
        details: { ships: 'fleet', shipLimit: 25, dailyMessages: 'default', dailyMessageLimit: null, retention: 'default', retentionDays: null },
      }),
    ]);
  });

  it('writes the retention the fleet now has in FleetLimitsChanged', async () => {
    unwrap(await setLimits({ fleetId, retention: { kind: 'fleet', days: 90 } }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'FleetLimitsChanged',
        details: { ships: 'default', shipLimit: null, dailyMessages: 'default', dailyMessageLimit: null, retention: 'fleet', retentionDays: 90 },
      }),
    ]);
  });

  it('refuses a retention of 0 days and of part of a day, and changes nothing', async () => {
    await expect(setLimits({ fleetId, retention: { kind: 'fleet', days: 0 } })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_RETENTION' } });
    await expect(setLimits({ fleetId, retention: { kind: 'fleet', days: 2.5 } })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_RETENTION' } });
    expect(core.state.events).toEqual([]);
  });

  it('refuses a negative limit, and a fleet the installation does not host', async () => {
    await expect(setLimits({ fleetId, ships: { kind: 'fleet', limit: -1 } })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_LIMIT' } });
    await expect(setLimits({ fleetId: core.ids('fleet'), ships: { kind: 'default' } })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_NOT_FOUND' } });
    expect(core.state.events).toEqual([]);
  });
});
