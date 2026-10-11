import { describe, expect, it } from 'vitest';

import { FLEET_ID, memoryManagementStore, SHIP_ID } from '../../../test/support/management-fakes.js';
import { memoryFleetSwitches, memoryInstallationRequests, plainHasher } from '../../../test/support/memory-installation.js';
import { fakeNetworkFleet } from '../../../test/support/network-fakes.js';
import { createWithdrawNetworkRules } from '../../core/network/withdraw-network-rules.js';
import { createFleetTurns } from './fleet-turns.js';
import { createSetFleetEnabledInTurn } from './set-fleet-enabled-in-turn.js';

const AT = new Date('2026-10-04T12:00:00.000Z');

/** A gate the test opens: work waiting on it stays in its turn until then. */
function aGate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** Lets every turn that could start start. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("a switch-off in the fleet's turn (#626)", () => {
  it('withdraws the rules only once the turn in flight, such as a rescan declaring them, is done', async () => {
    const management = memoryManagementStore();
    await management.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_squadrons', crewedAt: AT });
    const fleet = fakeNetworkFleet(new Set(['aeolus_ct_v1_squadrons']));
    const turns = createFleetTurns();
    const setEnabled = createSetFleetEnabledInTurn({
      switches: memoryFleetSwitches(),
      requests: memoryInstallationRequests(),
      hasher: plainHasher,
      clock: { now: () => AT },
      withdraw: createWithdrawNetworkRules({ door: fleet.door, management, declarations: new Map() }),
      turns,
    });
    const gate = aGate();

    const rescan = turns.take(FLEET_ID, () => gate.opened);
    const switchedOff = setEnabled({ requestId: 'r-1', fleetId: FLEET_ID, isEnabled: false });
    await settle();
    expect(fleet.state.declarations).toEqual([]);
    gate.open();
    await Promise.all([rescan, switchedOff]);

    expect(fleet.state.declarations).toEqual([[]]);
  });
});
