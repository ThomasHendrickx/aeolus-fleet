import { beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { createCreateFleet } from './create-fleet.js';
import { createGetInstallationFleet, type GetInstallationFleet } from './get-installation-fleet.js';

let core: InMemoryCore;
let getFleet: GetInstallationFleet;

beforeEach(() => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  getFleet = createGetInstallationFleet({ fleets: core.installationFleets, settings: core.installationSettings, health: core.health, snapshots: core.healthSnapshots, clock: core.clock });
});

describe('getting one fleet of the installation', () => {
  it('describes it as the list does', async () => {
    const { fleetId } = unwrap(
      await createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher })({ requestId: 'signup-1', name: 'hemma', operatorEmail: 'lena@example.com' }),
    );

    await expect(getFleet({ fleetId })).resolves.toEqual({
      isOk: true,
      value: {
        fleetId,
        name: 'hemma',
        operatorEmail: 'lena@example.com',
        createdAt: new Date('2026-10-04T12:00:00.000Z'),
        shipCount: 1,
        messagesLast7Days: 0,
        lastActivityAt: new Date('2026-10-04T12:00:00.000Z'),
        storage: 0,
        messagesToday: 0,
        messagesPerDay: ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((date) => ({ date, count: 0 })),
        limits: {
          ships: { setting: { kind: 'default' }, applies: null },
          dailyMessages: { setting: { kind: 'default' }, applies: null },
          schedulesPerShip: { setting: { kind: 'default' }, applies: null },
          minimumScheduleInterval: { setting: { kind: 'default' }, applies: null },
          retention: { setting: { kind: 'default' }, applies: null },
        },
        health: {
          oldestPendingAt: null,
          oldestInFlightAt: null,
          noShipCanTake: 0,
          needsAttention: 0,
          overdue: 0,
          stuck: [],
          // Read from its stuck snapshot: each closed hour at its mark, then now.
          stuckPerHour: [...Array.from({ length: 167 }, (_unused, index) => ({ at: new Date(Date.parse('2026-10-04T12:00:00.000Z') - (166 - index) * 3_600_000), count: 0 })), { at: new Date('2026-10-04T12:00:00.000Z'), count: 0 }],
          acknowledged: {
            count: 0,
            medianMs: null,
            perHour: [...Array.from({ length: 23 }, (_unused, index) => ({ at: new Date(Date.parse('2026-10-04T12:00:00.000Z') - (22 - index) * 3_600_000), count: 0 })), { at: new Date('2026-10-04T12:00:00.000Z'), count: 0 }],
          },
        },
        featureFlags: [{ flag: 'sealing', isOn: false, canTurnOff: true }],
      },
    });
  });

  it('answers each feature flag on or off for the fleet, and a flag its fleet uses as unable to go off (decision 0069)', async () => {
    const createFleet = createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher });
    const { fleetId: sealedFleetId } = unwrap(await createFleet({ requestId: 'signup-1', name: 'hemma', operatorEmail: 'lena@example.com', featureFlags: ['sealing'] }));
    const { fleetId: offeredFleetId } = unwrap(await createFleet({ requestId: 'signup-2', name: 'northwind', operatorEmail: 'ines@example.com', featureFlags: ['sealing'] }));
    const since = new Date('2026-10-04T12:00:00.000Z');
    core.state.fleetSealings.push({ fleetId: sealedFleetId, state: 'sealed', since, progress: { toSeal: 0, sealed: 0 }, companyKey: 'arn:aws:kms:eu-west-1:111122223333:key/hemma', recoveryKey: null, keyAvailability: { isAvailable: true, since } });

    expect(unwrap(await getFleet({ fleetId: sealedFleetId })).featureFlags).toEqual([{ flag: 'sealing', isOn: true, canTurnOff: false }]);
    expect(unwrap(await getFleet({ fleetId: offeredFleetId })).featureFlags).toEqual([{ flag: 'sealing', isOn: true, canTurnOff: true }]);
  });

  it('tells each step it awaited, in order, with the milliseconds it took, so a read that never answers names its step (#1523)', async () => {
    const { fleetId } = unwrap(
      await createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher })({ requestId: 'signup-1', name: 'hemma', operatorEmail: 'lena@example.com' }),
    );
    const steps: { step: string; ms: number }[] = [];

    unwrap(await getFleet({ fleetId }, (step, ms) => steps.push({ step, ms })));

    expect(steps).toEqual(['find', 'settings', 'latest', 'health'].map((step) => ({ step, ms: 0 })));
  });

  it('refuses a fleet the installation does not host', async () => {
    await expect(getFleet({ fleetId: core.ids('fleet') })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_NOT_FOUND' } });
  });
});
