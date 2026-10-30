import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { SealingState } from '../messaging/fleet-sealing.js';
import { createSetFeatureFlag, type SetFeatureFlag } from './set-feature-flag.js';

let core: InMemoryCore;
let setFeatureFlag: SetFeatureFlag;
let fleetId: FleetId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-30T12:00:00.000Z');
  setFeatureFlag = createSetFeatureFlag({ uow: core.uow, clock: core.clock, ids: core.ids });
  ({ fleetId } = await hostedFleet(core));
  core.state.events.length = 0;
});

/** The fleet as sealing turned on left it: sealing or sealed under a company key. */
function aFleetThatIs(state: SealingState): void {
  const since = new Date('2026-10-30T11:00:00.000Z');
  core.state.featureFlags.push({ fleetId, flag: 'sealing' });
  core.state.fleetSealings.push({ fleetId, state, since, progress: { toSeal: 0, sealed: 0 }, companyKey: 'arn:aws:kms:eu-west-1:111122223333:key/acme', recoveryKey: null, keyAvailability: { isAvailable: true, since } });
}

describe('setting a feature flag for a fleet (decision 0069)', () => {
  it('turns the sealing flag on for the fleet, with FeatureFlagTurnedOn by the installation', async () => {
    const turnedOn = unwrap(await setFeatureFlag({ fleetId, flag: 'sealing', isOn: true }));

    expect(turnedOn).toEqual({ flag: 'sealing', isOn: true, canTurnOff: true });
    expect(core.state.featureFlags).toEqual([{ fleetId, flag: 'sealing' }]);
    expect(core.state.events.map(({ type, actor, details }) => ({ type, actor, details }))).toEqual([{ type: 'FeatureFlagTurnedOn', actor: { kind: 'installation' }, details: { flag: 'sealing' } }]);
  });

  it('turns the sealing flag off for a fleet that does not use sealing, with FeatureFlagTurnedOff', async () => {
    core.state.featureFlags.push({ fleetId, flag: 'sealing' });

    const turnedOff = unwrap(await setFeatureFlag({ fleetId, flag: 'sealing', isOn: false }));

    expect(turnedOff).toEqual({ flag: 'sealing', isOn: false, canTurnOff: true });
    expect(core.state.featureFlags).toEqual([]);
    expect(core.state.events.map(({ type, actor, details }) => ({ type, actor, details }))).toEqual([{ type: 'FeatureFlagTurnedOff', actor: { kind: 'installation' }, details: { flag: 'sealing' } }]);
  });

  it.each(['sealing', 'sealed'] as const)('refuses the sealing flag off while the fleet is %s FEATURE_FLAG_IN_USE, saying sealed fleets keep sealing, and changes nothing', async (state) => {
    aFleetThatIs(state);
    const before = structuredClone(core.state);

    const refusal = refusalOf(await setFeatureFlag({ fleetId, flag: 'sealing', isOn: false }));

    expect(refusal).toEqual({ kind: 'FEATURE_FLAG_IN_USE', message: 'Sealed fleets keep sealing' });
    expect(core.state).toEqual(before);
  });

  it('refuses a fleet the installation does not host FLEET_NOT_FOUND, and changes nothing', async () => {
    const before = structuredClone(core.state);

    const refusal = refusalOf(await setFeatureFlag({ fleetId: idSchema('fleet').parse('flt_01jb8xk4tqzr3a9w6m2v5nyb4c'), flag: 'sealing', isOn: true }));

    expect(refusal.kind).toBe('FLEET_NOT_FOUND');
    expect(core.state).toEqual(before);
  });

  it('answers a flag set to what it is as it is, writing no event', async () => {
    core.state.featureFlags.push({ fleetId, flag: 'sealing' });

    const answered = unwrap(await setFeatureFlag({ fleetId, flag: 'sealing', isOn: true }));

    expect(answered).toEqual({ flag: 'sealing', isOn: true, canTurnOff: true });
    expect(core.state.featureFlags).toEqual([{ fleetId, flag: 'sealing' }]);
    expect(core.state.events).toEqual([]);
  });

  it('answers a sealed fleet whose flag is on as on and unable to go off', async () => {
    aFleetThatIs('sealed');

    expect(unwrap(await setFeatureFlag({ fleetId, flag: 'sealing', isOn: true }))).toEqual({ flag: 'sealing', isOn: true, canTurnOff: false });
  });
});
