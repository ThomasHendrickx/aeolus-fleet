import { accountIdSchema, type FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { AccountCaller } from '../shared/caller.js';
import { ok } from '../shared/result.js';
import { CONSOLE_SESSION_IDLE_LIMIT_MS } from './console-session.js';
import { createIssueSignInTicket, type IssueSignInTicket } from './issue-sign-in-ticket.js';
import { createReadArgoSignIn, type ReadArgoSignIn } from './read-argo-sign-in.js';
import { createRedeemSignInTicket, type RedeemSignInTicket } from './redeem-sign-in-ticket.js';
import { createSignOut, type SignOut } from './sign-out.js';

// Who holds argo's sign-in, for the console's warning before an account
// signs in as argo (accounts design, F4, A7): "This signs <name> out of argo."

let core: InMemoryCore;
let useCases: { issueSignInTicket: IssueSignInTicket; redeemSignInTicket: RedeemSignInTicket; readArgoSignIn: ReadArgoSignIn; signOut: SignOut };
let fleetId: FleetId;
let mathilde: AccountCaller;

const THOMAS = accountIdSchema.parse('acc-thomas');

async function signedInAsArgo(account?: { id: typeof THOMAS }) {
  const { ticket } = unwrap(await useCases.issueSignInTicket({ fleetId, ...(account === undefined ? {} : { account }) }));
  return unwrap(await useCases.redeemSignInTicket({ ticket }));
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-21T12:00:00.000Z');
  const deps = { uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher, random: core.random };
  useCases = {
    issueSignInTicket: createIssueSignInTicket(deps),
    redeemSignInTicket: createRedeemSignInTicket(deps),
    readArgoSignIn: createReadArgoSignIn(deps),
    signOut: createSignOut(deps),
  };
  ({ fleetId } = await hostedFleet(core));
  mathilde = { kind: 'account', accountId: accountIdSchema.parse('acc-mathilde'), fleetId, scopes: ['fleet:read'], groupValues: [], personShipId: null, throughShipId: null };
});

describe("who holds argo's sign-in", () => {
  it('is no one before anyone signs in as argo', async () => {
    await expect(useCases.readArgoSignIn(mathilde)).resolves.toEqual(ok({ isSignedIn: false }));
  });

  it('is the account signed in as argo, by its id', async () => {
    await signedInAsArgo({ id: THOMAS });

    await expect(useCases.readArgoSignIn(mathilde)).resolves.toEqual(ok({ isSignedIn: true, accountId: THOMAS }));
  });

  it("is argo's own sign-in, naming no account", async () => {
    await signedInAsArgo();

    await expect(useCases.readArgoSignIn(mathilde)).resolves.toEqual(ok({ isSignedIn: true, accountId: null }));
  });

  it('is no one once that sign-in signed out', async () => {
    const signedIn = await signedInAsArgo({ id: THOMAS });
    await useCases.signOut(signedIn.caller);

    await expect(useCases.readArgoSignIn(mathilde)).resolves.toEqual(ok({ isSignedIn: false }));
  });

  it('is no one once that sign-in went unused past its idle limit', async () => {
    await signedInAsArgo({ id: THOMAS });
    core.clock.advance(CONSOLE_SESSION_IDLE_LIMIT_MS + 1);

    await expect(useCases.readArgoSignIn(mathilde)).resolves.toEqual(ok({ isSignedIn: false }));
  });
});
