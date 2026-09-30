import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addAgentShip, initialiseFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import { shipActor, SYSTEM } from '../shared/events.js';
import { ok } from '../shared/result.js';
import { location } from './lease.js';
import { endLease, takeOverOperatorLease } from './leases.js';

let core: InMemoryCore;
let fleetId: FleetId;
let argoId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore();
  ({ fleetId, operatorShipId: argoId } = await initialiseFleet(core));
  core.state.events.length = 0;
});

const webConsole = unwrap(location('OTHER', 'web console'));

async function takeOver() {
  const takenOver = await core.uow.run((tx) =>
    takeOverOperatorLease({ tx, ids: core.ids }, {
      fleetId,
      shipId: argoId,
      kind: 'operator',
      location: webConsole,
      actor: shipActor(argoId),
      at: core.clock.now(),
    }),
  );
  return unwrap(takenOver);
}

describe('taking over the operator lease', () => {
  it('opens a lease with its location and writes ShipClaimed', async () => {
    const leaseId = await takeOver();

    expect(core.state.leases).toEqual([
      {
        id: leaseId,
        fleetId,
        shipId: argoId,
        location: { kind: 'OTHER', description: 'web console' },
        // The console session holds the token; the lease holds none.
        crewTokenHash: null,
        startedAt: core.clock.now(),
        endedAt: null,
      },
    ]);
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'ShipClaimed',
        actor: { kind: 'ship', shipId: argoId },
        shipId: argoId,
        details: { leaseId, location: 'OTHER', locationDescription: 'web console' },
      }),
    ]);
  });

  it('ends the lease held before, returns its deliveries in flight, clearing their claim, and writes LeaseRevoked first', async () => {
    const first = await takeOver();
    core.state.deliveries.push(
      { id: 'dlv_in_flight', fleetId, state: 'delivered', claimedByShipId: argoId, claimedByLeaseId: first },
      { id: 'dlv_done', fleetId, state: 'acknowledged', claimedByShipId: argoId, claimedByLeaseId: first },
    );
    core.state.events.length = 0;
    core.clock.advance(60_000);

    const second = await takeOver();

    expect(core.state.leases.map((lease) => [lease.id, lease.endedAt])).toEqual([
      [first, core.clock.now()],
      [second, null],
    ]);
    expect(core.state.deliveries).toEqual([
      { id: 'dlv_in_flight', fleetId, state: 'pending', claimedByShipId: null, claimedByLeaseId: null },
      { id: 'dlv_done', fleetId, state: 'acknowledged', claimedByShipId: argoId, claimedByLeaseId: first },
    ]);
    expect(core.state.events.map((event) => [event.type, event.details])).toEqual([
      ['LeaseRevoked', { leaseId: first, reason: 'takenOver', returnedDeliveries: 1 }],
      ['ShipClaimed', { leaseId: second, location: 'OTHER', locationDescription: 'web console' }],
    ]);
  });

  it('refuses an agent ship: a second claim on it fails instead', async () => {
    const agent = addAgentShip(core, { fleetId });

    await expect(
      core.uow.run((tx) =>
        takeOverOperatorLease({ tx, ids: core.ids }, {
          fleetId,
          shipId: agent.shipId,
          kind: 'agent',
          location: webConsole,
          actor: shipActor(agent.shipId),
          at: core.clock.now(),
        }),
      ),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_THE_OPERATOR_SHIP' } });
    expect(core.state.leases).toEqual([]);
  });
});

describe('ending a lease', () => {
  it('ends it once: a second end changes nothing and writes nothing', async () => {
    const leaseId = await takeOver();
    core.state.events.length = 0;
    const end = () =>
      core.uow.run(async (tx) =>
        ok(
          await endLease(
            { tx, ids: core.ids },
            { fleetId, leaseId, actor: SYSTEM, at: core.clock.now(), reason: 'passwordReset' },
          ),
        ),
      );

    await expect(end()).resolves.toEqual(ok(true));
    await expect(end()).resolves.toEqual(ok(false));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'LeaseRevoked',
        actor: { kind: 'system' },
        shipId: argoId,
        details: { leaseId, reason: 'passwordReset', returnedDeliveries: 0 },
      }),
    ]);
  });
});
