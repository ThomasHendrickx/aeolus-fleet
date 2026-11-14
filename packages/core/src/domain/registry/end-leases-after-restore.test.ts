import type { FleetId, LeaseId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewOfToken,
  deliveryInFlight,
  identityUseCases,
  initialiseFleet,
  OPERATOR,
  openLeaseOf,
  operatorCaller,
  registryUseCases,
  secretOf,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { createEndLeasesAfterRestore, type EndLeasesAfterRestore } from './end-leases-after-restore.js';

let core: InMemoryCore;
let endLeasesAfterRestore: EndLeasesAfterRestore;
let fleetId: FleetId;
let argoId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-11-14T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  endLeasesAfterRestore = createEndLeasesAfterRestore({ uow: core.uow, clock: core.clock, ids: core.ids });
});

/** A ship of the fleet commissioned and crewed by a session: its open lease. */
async function crewedShip(name: string): Promise<{ shipId: ShipId; leaseId: LeaseId }> {
  const registry = registryUseCases(core);
  const argo = operatorCaller({ fleetId, operatorShipId: argoId });
  const { shipId, secret } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  const { crewToken } = unwrap(
    await registry.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }),
  );
  const { leaseId } = await crewOfToken(core, crewToken);
  return { shipId, leaseId };
}

describe('ending the leases a restored fleet holds (fleet:restored)', () => {
  it("ends every open lease but argo's with the reason restored, its in-flight deliveries pending again, by the system", async () => {
    // Given a restored fleet whose argo is signed in, and two crewed ships, one holding a delivery in flight
    unwrap(await identityUseCases(core).signIn(OPERATOR));
    const argoLease = openLeaseOf(core, argoId);
    const scout = await crewedShip('scout');
    const lookout = await crewedShip('lookout');
    const { deliveryId } = deliveryInFlight(core, { fleetId, shipId: scout.shipId, leaseId: scout.leaseId });
    core.clock.advance(60_000);
    core.state.events.length = 0;

    // When fleet:restored runs for the fleet
    const ended = await endLeasesAfterRestore({ fleetId });

    // Then both ships' leases end with LeaseRevoked, reason restored, and the delivery is pending again; argo's stays open
    expect(ended).toEqual({ isOk: true, value: { endedLeases: 2 } });
    const at = core.clock.now();
    expect(core.state.leases.filter((lease) => lease.endedAt === null).map((lease) => lease.id)).toEqual([argoLease]);
    expect(core.state.deliveries[0]).toMatchObject({ id: deliveryId, state: 'pending', claimedByShipId: null });
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'LeaseRevoked',
        occurredAt: at,
        actor: { kind: 'system' },
        shipId: scout.shipId,
        details: { leaseId: scout.leaseId, reason: 'restored', returnedDeliveries: 1 },
      }),
      expect.objectContaining({ type: 'DeliveryReturned', actor: { kind: 'system' }, shipId: scout.shipId, deliveryId }),
      expect.objectContaining({
        type: 'LeaseRevoked',
        occurredAt: at,
        actor: { kind: 'system' },
        shipId: lookout.shipId,
        details: { leaseId: lookout.leaseId, reason: 'restored', returnedDeliveries: 0 },
      }),
    ]);
  });

  it('changes nothing in a fleet where no ship but argo is crewed', async () => {
    // Given a restored fleet with no crewed ship
    const before = structuredClone(core.state);

    // When fleet:restored runs for the fleet
    const ended = await endLeasesAfterRestore({ fleetId });

    // Then no lease ended and nothing was written
    expect(ended).toEqual({ isOk: true, value: { endedLeases: 0 } });
    expect(core.state).toEqual(before);
  });
});
