import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  deliveryInFlight,
  identityUseCases,
  initialiseFleet,
  OPERATOR,
  openLeaseOf,
  operatorCaller,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let fleet: Awaited<ReturnType<typeof initialiseFleet>>;

beforeEach(async () => {
  core = createInMemoryCore();
  useCases = identityUseCases(core);
  fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
});

describe('signing out', () => {
  it("ends the session and releases argo's lease", async () => {
    const { token, caller } = unwrap(await useCases.signIn(OPERATOR));
    const leaseId = openLeaseOf(core, argoId);
    const { deliveryId } = deliveryInFlight(core, { fleetId, shipId: argoId, leaseId });
    core.state.events.length = 0;
    core.clock.advance(60_000);

    await useCases.signOut(caller);

    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
    expect(core.state.consoleSessions[0]?.endedAt).toEqual(core.clock.now());
    expect(core.state.leases[0]?.endedAt).toEqual(core.clock.now());
    expect(core.state.deliveries[0]).toMatchObject({ state: 'pending', claimedByShipId: null });
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'LeaseRevoked',
        actor: { kind: 'ship', shipId: argoId },
        shipId: argoId,
        details: { leaseId, reason: 'signedOut', returnedDeliveries: 1 },
      }),
      expect.objectContaining({ type: 'DeliveryReturned', actor: { kind: 'ship', shipId: argoId }, deliveryId }),
    ]);
  });

  it('changes nothing the second time', async () => {
    const { caller } = unwrap(await useCases.signIn(OPERATOR));
    await useCases.signOut(caller);
    const before = structuredClone(core.state);

    await useCases.signOut(caller);

    expect(core.state).toEqual(before);
  });

  it('changes nothing for a caller without a console session', async () => {
    unwrap(await useCases.signIn(OPERATOR));
    const before = structuredClone(core.state);

    await useCases.signOut(operatorCaller(fleet));

    expect(core.state).toEqual(before);
  });

  it('never touches the lease of the session that took over', async () => {
    const first = unwrap(await useCases.signIn(OPERATOR));
    const second = unwrap(await useCases.signIn(OPERATOR));

    await useCases.signOut(first.caller);

    await expect(useCases.authenticate.byConsoleSession(second.token)).resolves.toMatchObject({ caller: { shipId: argoId } });
    expect(core.state.leases.filter((lease) => lease.endedAt === null)).toHaveLength(1);
  });
});
