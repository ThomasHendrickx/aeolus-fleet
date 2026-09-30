import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addAgentShip, crewAboard, deliveryInFlight, initialiseFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Crew } from '../shared/caller.js';
import { shipActor, SYSTEM, type Actor } from '../shared/events.js';
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

  it('ends the lease held before, returns its deliveries in flight, and writes LeaseRevoked and DeliveryReturned first', async () => {
    const first = await takeOver();
    const inFlight = deliveryInFlight(core, { fleetId, shipId: argoId, leaseId: first, attempts: 2 });
    core.state.events.length = 0;
    core.clock.advance(60_000);

    const second = await takeOver();

    expect(core.state.leases.map((lease) => [lease.id, lease.endedAt])).toEqual([
      [first, core.clock.now()],
      [second, null],
    ]);
    expect(core.state.deliveries).toEqual([
      expect.objectContaining({ id: inFlight.deliveryId, state: 'pending', claimedByShipId: null, attempts: 2 }),
    ]);
    expect(core.state.events.map((event) => [event.type, event.details])).toEqual([
      ['LeaseRevoked', { leaseId: first, reason: 'takenOver', returnedDeliveries: 1 }],
      ['DeliveryReturned', { leaseId: first, attempts: 2 }],
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
  let scoutId: ShipId;
  let scout: Crew;
  let lookout: Crew;

  beforeEach(() => {
    ({ shipId: scoutId } = addAgentShip(core, { fleetId, name: 'scout' }));
    scout = crewAboard(core, { fleetId, shipId: scoutId });
    lookout = crewAboard(core, { fleetId, shipId: addAgentShip(core, { fleetId, name: 'lookout' }).shipId });
    core.state.events.length = 0;
  });

  /** Ends scout's lease as a release by argo does, unless another actor ends it. */
  function endScoutLease(actor: Actor = shipActor(argoId)) {
    return core.uow.run(async (tx) =>
      ok(
        await endLease(
          { tx, ids: core.ids },
          { fleetId, leaseId: scout.leaseId, actor, at: core.clock.now(), reason: 'released' },
        ),
      ),
    );
  }

  function stored(deliveryId: DeliveryId) {
    return core.state.deliveries.find((delivery) => delivery.id === deliveryId);
  }

  it('returns a direct delivery in flight to its ship: pending, its claim cleared, its attempts kept', async () => {
    const { deliveryId } = deliveryInFlight(core, { fleetId, shipId: scoutId, leaseId: scout.leaseId, attempts: 3 });

    await endScoutLease();

    expect(stored(deliveryId)).toMatchObject({
      recipient: { kind: 'ship', shipId: scoutId },
      state: 'pending',
      claimedByShipId: null,
      claimedByLeaseId: null,
      attempts: 3,
    });
  });

  it('returns a type delivery in flight to the queue of its type, its attempts kept', async () => {
    const { deliveryId } = deliveryInFlight(core, {
      fleetId,
      shipId: scoutId,
      leaseId: scout.leaseId,
      recipient: { kind: 'type', type: 'reviewer' },
      attempts: 2,
    });

    await endScoutLease();

    expect(stored(deliveryId)).toMatchObject({
      recipient: { kind: 'type', type: 'reviewer' },
      state: 'pending',
      claimedByShipId: null,
      claimedByLeaseId: null,
      attempts: 2,
    });
  });

  it("returns only that lease's deliveries in flight: an acknowledged one and another crew's stay as they are", async () => {
    const acknowledged = deliveryInFlight(core, { fleetId, shipId: scoutId, leaseId: scout.leaseId });
    const acknowledgedDelivery = stored(acknowledged.deliveryId);
    if (acknowledgedDelivery) {
      acknowledgedDelivery.state = 'acknowledged';
    }
    const lookouts = deliveryInFlight(core, { fleetId, shipId: lookout.shipId, leaseId: lookout.leaseId });

    await endScoutLease();

    expect(stored(acknowledged.deliveryId)).toMatchObject({ state: 'acknowledged', claimedByLeaseId: scout.leaseId });
    expect(stored(lookouts.deliveryId)).toMatchObject({ state: 'delivered', claimedByLeaseId: lookout.leaseId });
  });

  it('wakes whoever waits for each returned delivery, as a send does: a notice for its ship or its type, oldest first', async () => {
    const direct = deliveryInFlight(core, { fleetId, shipId: scoutId, leaseId: scout.leaseId });
    core.clock.advance(1_000);
    const forType = deliveryInFlight(core, {
      fleetId,
      shipId: scoutId,
      leaseId: scout.leaseId,
      recipient: { kind: 'type', type: 'reviewer' },
    });
    deliveryInFlight(core, { fleetId, shipId: lookout.shipId, leaseId: lookout.leaseId });

    await endScoutLease();

    expect(core.state.notices).toEqual([
      { fleetId, deliveryId: direct.deliveryId, recipient: { kind: 'ship', shipId: scoutId } },
      { fleetId, deliveryId: forType.deliveryId, recipient: { kind: 'type', type: 'reviewer' } },
    ]);
  });

  it('writes LeaseRevoked, then one DeliveryReturned per returned delivery, oldest first, caused by whoever ended the lease', async () => {
    const older = deliveryInFlight(core, { fleetId, shipId: scoutId, leaseId: scout.leaseId, attempts: 1 });
    core.clock.advance(1_000);
    const newer = deliveryInFlight(core, {
      fleetId,
      shipId: scoutId,
      leaseId: scout.leaseId,
      recipient: { kind: 'type', type: 'reviewer' },
      attempts: 4,
    });
    const endedAt = core.clock.now();

    await endScoutLease(shipActor(scoutId));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'LeaseRevoked',
        occurredAt: endedAt,
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        details: { leaseId: scout.leaseId, reason: 'released', returnedDeliveries: 2 },
      }),
      expect.objectContaining({
        type: 'DeliveryReturned',
        occurredAt: endedAt,
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        messageId: older.messageId,
        deliveryId: older.deliveryId,
        details: { leaseId: scout.leaseId, attempts: 1 },
      }),
      expect.objectContaining({
        type: 'DeliveryReturned',
        messageId: newer.messageId,
        deliveryId: newer.deliveryId,
        details: { leaseId: scout.leaseId, attempts: 4 },
      }),
    ]);
  });

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
