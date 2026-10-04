import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { deliveryInFlight, openLeaseOf, hostedFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import { createIssueSignInTicket, type IssueSignInTicket } from './issue-sign-in-ticket.js';
import { createRedeemSignInTicket, type RedeemSignInTicket } from './redeem-sign-in-ticket.js';

const TWO_MINUTES_MS = 2 * 60 * 1000;
const INVALID = { isOk: false, error: { kind: 'SIGN_IN_TICKET_INVALID', message: 'This sign-in link is used or expired: sign in again' } };

let core: InMemoryCore;
let useCases: { issueSignInTicket: IssueSignInTicket; redeemSignInTicket: RedeemSignInTicket };
let fleetId: FleetId;
let argoId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  const deps = { uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher, random: core.random };
  useCases = { issueSignInTicket: createIssueSignInTicket(deps), redeemSignInTicket: createRedeemSignInTicket(deps) };
  ({ fleetId, operatorShipId: argoId } = await hostedFleet(core));
});

describe('redeeming a sign-in ticket', () => {
  it('starts a console session crewing argo, as a password sign-in does', async () => {
    const { ticket } = unwrap(await useCases.issueSignInTicket({ fleetId }));

    const signedIn = unwrap(await useCases.redeemSignInTicket({ ticket, device: 'Mac · Safari' }));

    expect(signedIn.caller).toMatchObject({ fleetId, shipId: argoId, kind: 'operator' });
    expect(core.state.consoleSessions).toEqual([expect.objectContaining({ id: signedIn.consoleSessionId, fleetId, device: 'Mac · Safari', endedAt: null })]);
    expect(core.state.leases).toEqual([expect.objectContaining({ shipId: argoId, endedAt: null })]);
  });

  it('ends the previous session and takes argo over, so what it held in flight returns to pending', async () => {
    const first = unwrap(await useCases.redeemSignInTicket({ ticket: unwrap(await useCases.issueSignInTicket({ fleetId })).ticket }));
    const { deliveryId } = deliveryInFlight(core, { fleetId, shipId: argoId, leaseId: openLeaseOf(core, argoId) });

    unwrap(await useCases.redeemSignInTicket({ ticket: unwrap(await useCases.issueSignInTicket({ fleetId })).ticket }));

    expect(core.state.consoleSessions.find((session) => session.id === first.consoleSessionId)).toMatchObject({ endReason: 'takenOver' });
    expect(core.state.deliveries.find((delivery) => delivery.id === deliveryId)).toMatchObject({ state: 'pending' });
  });

  it('signs in once and never again', async () => {
    const { ticket } = unwrap(await useCases.issueSignInTicket({ fleetId }));
    unwrap(await useCases.redeemSignInTicket({ ticket }));

    await expect(useCases.redeemSignInTicket({ ticket })).resolves.toEqual(INVALID);
    expect(core.state.consoleSessions).toHaveLength(1);
  });

  it('refuses a ticket 2 minutes after it was issued, and takes it just before', async () => {
    const late = unwrap(await useCases.issueSignInTicket({ fleetId }));
    const inTime = unwrap(await useCases.issueSignInTicket({ fleetId }));
    core.clock.advance(TWO_MINUTES_MS - 1);
    unwrap(await useCases.redeemSignInTicket({ ticket: inTime.ticket }));
    core.clock.advance(1);

    await expect(useCases.redeemSignInTicket({ ticket: late.ticket })).resolves.toEqual(INVALID);
  });

  it('refuses a ticket it never issued, the same way', async () => {
    await expect(useCases.redeemSignInTicket({ ticket: 'aeolus_st_v1_unknown' })).resolves.toEqual(INVALID);
    expect(core.state.consoleSessions).toEqual([]);
  });
});
