import { accountIdSchema, type AccountId, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { deliveryInFlight, hostedFleet, openLeaseOf } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { createIssueSignInTicket, type IssueSignInTicket } from './issue-sign-in-ticket.js';
import { createRedeemSignInTicket, type RedeemSignInTicket } from './redeem-sign-in-ticket.js';
import { createSignOutAccount, type SignOutAccount } from './sign-out-account.js';

const burak = accountIdSchema.parse('acc-burak');

describe('an account signing out in the account app while signed in to the console as argo', () => {
  let core: InMemoryCore;
  let signOutAccount: SignOutAccount;
  let issueSignInTicket: IssueSignInTicket;
  let redeemSignInTicket: RedeemSignInTicket;
  let hemma: { fleetId: FleetId; operatorShipId: ShipId };
  let fjord: { fleetId: FleetId; operatorShipId: ShipId };

  beforeEach(async () => {
    core = createInMemoryCore('2026-10-22T10:00:00.000Z');
    const deps = { uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher, random: core.random };
    issueSignInTicket = createIssueSignInTicket(deps);
    redeemSignInTicket = createRedeemSignInTicket(deps);
    signOutAccount = createSignOutAccount({ uow: core.uow, ids: core.ids, clock: core.clock });
    hemma = await hostedFleet(core, 'lena@example.com');
    fjord = await hostedFleet(core, 'priya@example.com');
  });

  async function signIn(fleetId: FleetId, account?: AccountId) {
    const { ticket } = unwrap(await issueSignInTicket(account === undefined ? { fleetId } : { fleetId, account: { id: account } }));
    return unwrap(await redeemSignInTicket({ ticket }));
  }

  it("ends its console sign-in as argo in every fleet of the installation, and argo's lease with it", async () => {
    await signIn(hemma.fleetId, burak);
    await signIn(fjord.fleetId, burak);

    await signOutAccount({ accountId: burak });

    expect(core.state.consoleSessions.map(({ fleetId, endReason }) => ({ fleetId, endReason }))).toEqual([
      { fleetId: hemma.fleetId, endReason: 'signedOut' },
      { fleetId: fjord.fleetId, endReason: 'signedOut' },
    ]);
    expect(core.state.leases.filter((lease) => lease.endedAt === null)).toEqual([]);
  });

  it("leaves argo's own sign-in and an argo sign-in another account holds alone", async () => {
    await signIn(hemma.fleetId);
    await signIn(fjord.fleetId, accountIdSchema.parse('acc-priya'));

    await signOutAccount({ accountId: burak });

    expect(core.state.consoleSessions.map((session) => session.endedAt)).toEqual([null, null]);
    expect(core.state.leases.filter((lease) => lease.endedAt === null)).toHaveLength(2);
  });

  it('writes LeaseRevoked by the installation as a sign-out, and returns what argo held in flight', async () => {
    await signIn(hemma.fleetId, burak);
    const leaseId = openLeaseOf(core, hemma.operatorShipId);
    const { deliveryId } = deliveryInFlight(core, { fleetId: hemma.fleetId, shipId: hemma.operatorShipId, leaseId });
    core.state.events.length = 0;

    await signOutAccount({ accountId: burak });

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'LeaseRevoked', fleetId: hemma.fleetId, shipId: hemma.operatorShipId, actor: { kind: 'installation' }, details: { leaseId, reason: 'signedOut', returnedDeliveries: 1 } }),
      expect.objectContaining({ type: 'DeliveryReturned', deliveryId }),
    ]);
    expect(core.state.deliveries.find((delivery) => delivery.id === deliveryId)).toMatchObject({ state: 'pending' });
  });
});
