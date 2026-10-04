import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import { createIssueSignInTicket, type IssueSignInTicket } from './issue-sign-in-ticket.js';
import { createRedeemSignInTicket, type RedeemSignInTicket } from './redeem-sign-in-ticket.js';

const TWO_MINUTES_MS = 2 * 60 * 1000;

let core: InMemoryCore;
let useCases: { issueSignInTicket: IssueSignInTicket; redeemSignInTicket: RedeemSignInTicket };
let fleetId: FleetId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  const deps = { uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher, random: core.random };
  useCases = { issueSignInTicket: createIssueSignInTicket(deps), redeemSignInTicket: createRedeemSignInTicket(deps) };
  ({ fleetId } = await hostedFleet(core));
  core.state.events.length = 0;
});

describe("issuing a sign-in ticket for a fleet's operator", () => {
  it('answers a new ticket, and stores only its hash, valid 2 minutes and unused', async () => {
    const { ticket } = unwrap(await useCases.issueSignInTicket({ fleetId }));

    expect(ticket).toMatch(/^aeolus_st_v1_./);
    expect(core.state.signInTickets).toEqual([
      { fleetId, as: 'operator', tokenHash: core.hasher.hash(ticket), issuedAt: core.clock.now(), expiresAt: new Date(core.clock.now().getTime() + TWO_MINUTES_MS), usedAt: null },
    ]);
    expect(JSON.stringify(core.state)).not.toContain(`"${ticket}"`);
  });

  it('writes SignInTicketIssued in the fleet, by the system', async () => {
    unwrap(await useCases.issueSignInTicket({ fleetId }));

    expect(core.state.events).toEqual([expect.objectContaining({ fleetId, type: 'SignInTicketIssued', actor: { kind: 'system' }, details: { as: 'operator' } })]);
  });

  it('gives a new ticket each time; an earlier unused one still stands until it expires', async () => {
    const first = unwrap(await useCases.issueSignInTicket({ fleetId }));
    const second = unwrap(await useCases.issueSignInTicket({ fleetId }));

    expect(second.ticket).not.toBe(first.ticket);
    expect(core.state.signInTickets.map((ticket) => ticket.usedAt)).toEqual([null, null]);
  });

  it('refuses a fleet the installation does not host', async () => {
    await expect(useCases.issueSignInTicket({ fleetId: core.ids('fleet') })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_NOT_FOUND' } });
  });
});
