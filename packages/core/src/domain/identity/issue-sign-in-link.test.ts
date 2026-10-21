import { createIdGenerator, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { createIssueSignInLink, type IssueSignInLink } from './issue-sign-in-link.js';
import { createRedeemSignInTicket, type RedeemSignInTicket } from './redeem-sign-in-ticket.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const INVALID = { isOk: false, error: { kind: 'SIGN_IN_TICKET_INVALID' } };

let core: InMemoryCore;
let issueSignInLink: IssueSignInLink;
let redeemSignInTicket: RedeemSignInTicket;
let fleetId: FleetId;
let argoId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-21T12:00:00.000Z');
  const deps = { uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher, random: core.random };
  issueSignInLink = createIssueSignInLink(deps);
  redeemSignInTicket = createRedeemSignInTicket(deps);
  ({ fleetId, operatorShipId: argoId } = await initialiseFleet(core, 'my fleet'));
});

describe('a sign-in link from the terminal', () => {
  it("signs in as argo's own sign-in, naming no account", async () => {
    const { ticket } = unwrap(await issueSignInLink({ fleetId }));

    const signedIn = unwrap(await redeemSignInTicket({ ticket, device: 'Mac · Firefox' }));

    expect(signedIn.caller).toMatchObject({ fleetId, shipId: argoId, kind: 'operator' });
    expect(signedIn.caller.signedInAccountId).toBeUndefined();
  });

  it('signs in once', async () => {
    const { ticket } = unwrap(await issueSignInLink({ fleetId }));
    unwrap(await redeemSignInTicket({ ticket }));

    await expect(redeemSignInTicket({ ticket })).resolves.toMatchObject(INVALID);
  });

  it('works just before 15 minutes, and says when it ends', async () => {
    const { ticket, expiresAt } = unwrap(await issueSignInLink({ fleetId }));
    core.clock.advance(FIFTEEN_MINUTES_MS - 1);

    expect(expiresAt).toEqual(new Date('2026-10-21T12:15:00.000Z'));
    await expect(redeemSignInTicket({ ticket })).resolves.toMatchObject({ isOk: true });
  });

  it('is refused 15 minutes after it was issued', async () => {
    const { ticket } = unwrap(await issueSignInLink({ fleetId }));
    core.clock.advance(FIFTEEN_MINUTES_MS);

    await expect(redeemSignInTicket({ ticket })).resolves.toMatchObject(INVALID);
  });

  it('stores only the hash of the ticket', async () => {
    const { ticket } = unwrap(await issueSignInLink({ fleetId }));

    expect(core.state.signInTickets).toEqual([expect.objectContaining({ fleetId, as: 'operator', accountId: null, tokenHash: core.hasher.hash(ticket) })]);
    expect(JSON.stringify(core.state)).not.toContain(`"${ticket}"`);
  });

  it('writes SignInTicketIssued for the operator, by the system', async () => {
    core.state.events.length = 0;

    unwrap(await issueSignInLink({ fleetId }));

    expect(core.state.events).toEqual([expect.objectContaining({ fleetId, type: 'SignInTicketIssued', actor: { kind: 'system' }, details: { as: 'operator' } })]);
  });

  it('refuses a fleet the installation does not hold', async () => {
    await expect(issueSignInLink({ fleetId: createIdGenerator()('fleet') })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_NOT_FOUND' } });
  });
});
