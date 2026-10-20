import { accountIdSchema, REACH_REFUSALS_READ_MAX, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet, initialiseFleet, operatorCaller, readReachOf } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { ReachRefusal } from './reach-refusal.js';
import { createReadReachRefusals } from './read-reach-refusals.js';

let core: InMemoryCore;
let fleetId: FleetId;
let argo: ShipCaller;
let readReachRefusals: ReturnType<typeof createReadReachRefusals>;

/** A refusal straight into the state, from planner to vault, at the clock's time. */
function aRefusal(onFleet: FleetId = fleetId): ReachRefusal {
  const refusal: ReachRefusal = {
    fleetId: onFleet,
    id: core.ids('reachRefusal'),
    at: core.clock.now(),
    sender: { kind: 'ship', id: core.ids('ship'), name: 'planner', labels: [], owner: null },
    askedBy: null,
    recipient: { kind: 'ship', ship: { id: core.ids('ship'), name: 'vault', labels: [], owner: null } },
    verb: 'send',
    settingsVersion: 1,
  };
  core.state.reachRefusals.push(refusal);
  return refusal;
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-09T19:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  readReachRefusals = createReadReachRefusals({ reachRefusals: core.reachRefusals, readReach: readReachOf(core) });
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

});

describe('reading the reach refusals with fleet:explain (decision 0053)', () => {
  it('answers any actor holding fleet:explain the refusals whose sender or recipient ship it reads, and no other', async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();
    const read = createReadReachRefusals({ reachRefusals: fleet.core.reachRefusals, readReach: readReachOf(fleet.core) });
    const asSeen = (ship: { shipId: ShipId }) => ({ id: ship.shipId, name: 'as it was', labels: [], owner: null });
    const refusal = (sender: ReachRefusal['sender'], recipient: { shipId: ShipId }): ReachRefusal => ({
      fleetId: fleet.fleetId,
      id: fleet.core.ids('reachRefusal'),
      at: fleet.core.clock.now(),
      sender,
      askedBy: null,
      recipient: { kind: 'ship', ship: asSeen(recipient) },
      verb: 'send',
      settingsVersion: 1,
    });
    const toNear = refusal({ kind: 'ship', ...asSeen(fleet.far) }, fleet.near);
    const fromNear = refusal({ kind: 'ship', ...asSeen(fleet.near) }, fleet.far);
    const farToFar = refusal({ kind: 'ship', ...asSeen(fleet.far) }, fleet.far);
    const accountToFar = refusal({ kind: 'account', accountId: accountIdSchema.parse('acc-mathilde'), labels: [], personShip: null }, fleet.far);
    fleet.core.state.reachRefusals.push(toNear, fromNear, farToFar, accountToFar);
    const explainer: ShipCaller = { ...fleet.reader, scopes: ['fleet:explain'] };

    const answered = unwrap(await read(explainer));

    expect(answered.map(({ id }) => id).toSorted()).toEqual([toNear.id, fromNear.id].toSorted());
  });
});
