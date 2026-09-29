import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { identityUseCases, initialiseFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let secret: string;

beforeEach(async () => {
  core = createInMemoryCore();
  useCases = identityUseCases(core);
  ({ fleetId, operatorShipId: argoId, secret } = await initialiseFleet(core));
});

describe('signing out', () => {
  it("ends the session and releases argo's lease", async () => {
    const { token, caller } = await useCases.signIn({ secret });
    core.state.deliveries.push({ id: 'dlv_in_flight', fleetId, state: 'delivered', claimedByShipId: argoId });
    core.state.events.length = 0;
    core.clock.advance(60_000);

    await useCases.signOut(caller);

    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
    expect(core.state.consoleSessions[0]?.endedAt).toEqual(core.clock.now());
    expect(core.state.leases[0]?.endedAt).toEqual(core.clock.now());
    expect(core.state.deliveries[0]).toMatchObject({ state: 'pending', claimedByShipId: null });
    expect(core.state.events).toHaveLength(1);
    expect(core.state.events[0]).toMatchObject({
      type: 'LeaseRevoked',
      actor: { kind: 'ship', shipId: argoId },
      shipId: argoId,
      details: { reason: 'signedOut', returnedDeliveries: 1 },
    });
  });

  it('changes nothing the second time', async () => {
    const { caller } = await useCases.signIn({ secret });
    await useCases.signOut(caller);
    const before = structuredClone(core.state);

    await useCases.signOut(caller);

    expect(core.state).toEqual(before);
  });

  it('changes nothing for a caller that used the ship secret rather than a console session', async () => {
    await useCases.signIn({ secret });
    const bearer = await useCases.authenticate.bySecret(secret);
    const before = structuredClone(core.state);

    await useCases.signOut(bearer ?? expect.unreachable());

    expect(core.state).toEqual(before);
  });

  it('never touches the lease of the session that took over', async () => {
    const first = await useCases.signIn({ secret });
    const second = await useCases.signIn({ secret });

    await useCases.signOut(first.caller);

    await expect(useCases.authenticate.byConsoleSession(second.token)).resolves.toMatchObject({ shipId: argoId });
    expect(core.state.leases.filter((lease) => lease.endedAt === null)).toHaveLength(1);
  });
});
