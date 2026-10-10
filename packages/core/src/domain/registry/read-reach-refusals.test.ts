import { REACH_REFUSALS_READ_MAX, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet, initialiseFleet, operatorCaller } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import type { ReachRefusal } from './reach-refusal.js';
import { createReadReachRefusals } from './read-reach-refusals.js';

let core: InMemoryCore;
let fleetId: FleetId;
let argo: Caller;
let readReachRefusals: ReturnType<typeof createReadReachRefusals>;

/** A refusal straight into the state, from planner to vault, at the clock's time. */
function aRefusal(onFleet: FleetId = fleetId): ReachRefusal {
  const refusal: ReachRefusal = {
    fleetId: onFleet,
    id: core.ids('reachRefusal'),
    at: core.clock.now(),
    sender: { id: core.ids('ship'), name: 'planner', labels: [] },
    recipient: { kind: 'ship', ship: { id: core.ids('ship'), name: 'vault', labels: [] } },
    settingsVersion: 1,
    whilePluginUnavailable: null,
  };
  core.state.reachRefusals.push(refusal);
  return refusal;
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-09T19:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  readReachRefusals = createReadReachRefusals({ reachRefusals: core.reachRefusals });
});

describe('reading the reach refusals', () => {
  it("answers argo the fleet's refusals, newest first", async () => {
    const first = aRefusal();
    core.clock.advance(1_000);
    const second = aRefusal();

    expect(unwrap(await readReachRefusals(argo))).toEqual([second, first]);
  });

  it(`answers the latest ${String(REACH_REFUSALS_READ_MAX)} at most`, async () => {
    const refusals = Array.from({ length: REACH_REFUSALS_READ_MAX + 1 }, () => {
      core.clock.advance(1);
      return aRefusal();
    });

    const read = unwrap(await readReachRefusals(argo));

    expect(read).toHaveLength(REACH_REFUSALS_READ_MAX);
    expect(read.at(-1)).toEqual(refusals[1]);
  });

  it("answers none of another fleet's refusals", async () => {
    const other = await hostedFleet(core, 'other@example.com');
    aRefusal(other.fleetId);

    expect(unwrap(await readReachRefusals(argo))).toEqual([]);
  });

  it('refuses every ship but argo, even one that sets the rules', async () => {
    const setter: Caller = { fleetId, shipId: core.ids('ship') satisfies ShipId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:network'] };

    expect(refusalOf(await readReachRefusals(setter))).toEqual({ kind: 'NOT_THE_OPERATOR_SHIP', message: 'Only argo reads the reach refusals' });
  });
});
