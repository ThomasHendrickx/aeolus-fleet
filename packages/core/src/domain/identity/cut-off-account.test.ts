import { accountIdSchema, type AccountId, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { deliveryInFlight, hostedFleet, openLeaseOf } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { createCutOffAccount, type CutOffAccount } from './cut-off-account.js';
import { createIssueSignInTicket, type IssueSignInTicket } from './issue-sign-in-ticket.js';
import { createRedeemSignInTicket, type RedeemSignInTicket } from './redeem-sign-in-ticket.js';
import type { AccountCutOff, AccountCutOffRepository } from './ports.js';

const MINUTE_MS = 60_000;
const burak = accountIdSchema.parse('acc-burak');

/** The cut-offs kept in memory, as the Postgres adapter keeps them in its table. */
function inMemoryCutOffs(): AccountCutOffRepository {
  const kept = new Map<AccountId, AccountCutOff>();
  return {
    record: (cutOff) => {
      const held = kept.get(cutOff.accountId);
      if (!held || held.cutOffAt < cutOff.cutOffAt) {
        kept.set(cutOff.accountId, cutOff);
      }
      return Promise.resolve();
    },
    cutOffAt: (accountId, at) => {
      const held = kept.get(accountId);
      return Promise.resolve(held && held.forgetAt > at ? held.cutOffAt : undefined);
    },
    forget: (at) => {
      for (const [accountId, held] of kept) {
        if (held.forgetAt <= at) {
          kept.delete(accountId);
        }
      }
      return Promise.resolve();
    },
  };
}

function cutOffAt(time: string) {
  const cutOffs = inMemoryCutOffs();
  const core = createInMemoryCore(time);
  let now = new Date(time);
  const cutOffAccount = createCutOffAccount({ cutOffs, uow: core.uow, ids: core.ids, clock: { now: () => now } });
  return {
    cutOffAccount,
    cutOffs,
    now: () => now,
    pass: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

describe('cutting off an account', () => {
  it('refuses its tokens issued before now', async () => {
    const { cutOffAccount, cutOffs, now } = cutOffAt('2026-10-19T10:00:00Z');

    await cutOffAccount({ accountId: burak });

    expect(await cutOffs.cutOffAt(burak, now())).toEqual(new Date('2026-10-19T10:00:00Z'));
  });

  it('keeps the cut-off until the longest token issued before it has ended: 10 minutes and 30 seconds of life and 30 seconds of allowance', async () => {
    const { cutOffAccount, cutOffs, now, pass } = cutOffAt('2026-10-19T10:00:00Z');
    await cutOffAccount({ accountId: burak });

    pass(11 * MINUTE_MS - 1);

    expect(await cutOffs.cutOffAt(burak, now())).toEqual(new Date('2026-10-19T10:00:00Z'));
  });

  it('forgets the account once that token has ended', async () => {
    const { cutOffAccount, cutOffs, now, pass } = cutOffAt('2026-10-19T10:00:00Z');
    await cutOffAccount({ accountId: burak });

    pass(11 * MINUTE_MS);

    expect(await cutOffs.cutOffAt(burak, now())).toBeUndefined();
  });

  it('moves the cut-off on when the account is cut off again', async () => {
    const { cutOffAccount, cutOffs, now, pass } = cutOffAt('2026-10-19T10:00:00Z');
    await cutOffAccount({ accountId: burak });
    pass(5 * MINUTE_MS);

    await cutOffAccount({ accountId: burak });
    pass(10 * MINUTE_MS);

    expect(await cutOffs.cutOffAt(burak, now())).toEqual(new Date('2026-10-19T10:05:00Z'));
  });

  it('forgets every cut-off that has ended when it records one', async () => {
    const { cutOffAccount, cutOffs, pass } = cutOffAt('2026-10-19T10:00:00Z');
    await cutOffAccount({ accountId: burak });
    pass(11 * MINUTE_MS);
    await cutOffAccount({ accountId: accountIdSchema.parse('acc-priya') });

    // Asked as of long before, a kept cut-off would still answer: it is gone.
    expect(await cutOffs.cutOffAt(burak, new Date(0))).toBeUndefined();
  });
});

describe('cutting off an account signed in to the console as argo', () => {
  let core: InMemoryCore;
  let cutOffAccount: CutOffAccount;
  let issueSignInTicket: IssueSignInTicket;
  let redeemSignInTicket: RedeemSignInTicket;
  let hemma: { fleetId: FleetId; operatorShipId: ShipId };
  let fjord: { fleetId: FleetId; operatorShipId: ShipId };

  beforeEach(async () => {
    core = createInMemoryCore('2026-10-20T10:00:00.000Z');
    const deps = { uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher, random: core.random };
    issueSignInTicket = createIssueSignInTicket(deps);
    redeemSignInTicket = createRedeemSignInTicket(deps);
    cutOffAccount = createCutOffAccount({ cutOffs: inMemoryCutOffs(), uow: core.uow, ids: core.ids, clock: core.clock });
    hemma = await hostedFleet(core, 'lena@example.com');
    fjord = await hostedFleet(core, 'priya@example.com');
  });

  async function signIn(fleetId: FleetId, account?: AccountId) {
    const { ticket } = unwrap(await issueSignInTicket(account === undefined ? { fleetId } : { fleetId, account: { id: account } }));
    return unwrap(await redeemSignInTicket({ ticket }));
  }

  it("ends its console sign-in as argo in every fleet of the installation, and argo's lease with it (decision 0055)", async () => {
    await signIn(hemma.fleetId, burak);
    await signIn(fjord.fleetId, burak);

    await cutOffAccount({ accountId: burak });

    expect(core.state.consoleSessions.map(({ fleetId, endReason }) => ({ fleetId, endReason }))).toEqual([
      { fleetId: hemma.fleetId, endReason: 'accountCutOff' },
      { fleetId: fjord.fleetId, endReason: 'accountCutOff' },
    ]);
    expect(core.state.leases.filter((lease) => lease.endedAt === null)).toEqual([]);
  });

  it("leaves argo's own sign-in and another account's sign-in alone", async () => {
    await signIn(hemma.fleetId);
    await signIn(fjord.fleetId, accountIdSchema.parse('acc-priya'));

    await cutOffAccount({ accountId: burak });

    expect(core.state.consoleSessions.map((session) => session.endedAt)).toEqual([null, null]);
    expect(core.state.leases.filter((lease) => lease.endedAt === null)).toHaveLength(2);
  });

  it('writes LeaseRevoked by the installation with the reason, and returns what argo held in flight', async () => {
    await signIn(hemma.fleetId, burak);
    const leaseId = openLeaseOf(core, hemma.operatorShipId);
    const { deliveryId } = deliveryInFlight(core, { fleetId: hemma.fleetId, shipId: hemma.operatorShipId, leaseId });
    core.state.events.length = 0;

    await cutOffAccount({ accountId: burak });

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'LeaseRevoked', fleetId: hemma.fleetId, shipId: hemma.operatorShipId, actor: { kind: 'installation' }, details: { leaseId, reason: 'accountCutOff', returnedDeliveries: 1 } }),
      expect.objectContaining({ type: 'DeliveryReturned', deliveryId }),
    ]);
    expect(core.state.deliveries.find((delivery) => delivery.id === deliveryId)).toMatchObject({ state: 'pending' });
  });
});
