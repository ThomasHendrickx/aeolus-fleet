import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleetWithViewer, identityUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Notice } from './notice.js';
import type { SignedIn } from './sign-in.js';

// The notices a console session reads above every page (decision 0023):
// those of its audience, less those it dismissed.

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let fleetId: FleetId;

function aNotice(overrides: Partial<Notice> = {}): Notice {
  return { id: 'upgrade', audience: 'everyone', text: 'Interruptions expected between 00:00 and 01:00.', links: [], isDismissible: false, ...overrides };
}

const forEveryone = aNotice();
const forOperators = aNotice({ id: 'limits', audience: 'operators', text: 'Your fleet is near its ship limit.' });
const forViewers = aNotice({ id: 'welcome', audience: 'viewers', text: 'You are looking at a live fleet.', links: [{ label: 'Leave', url: 'https://pagasae.example.com', isSignOut: true }], isDismissible: true });

beforeEach(async () => {
  core = createInMemoryCore('2026-10-05T09:00:00.000Z');
  useCases = identityUseCases(core);
  ({ fleetId } = await hostedFleetWithViewer(core));
});

async function signedIn(as: 'operator' | 'viewer'): Promise<SignedIn> {
  const { ticket } = unwrap(await useCases.issueSignInTicket({ fleetId, as }));
  return unwrap(await useCases.redeemSignInTicket({ ticket, device: 'Mac · Safari' }));
}


describe('the notices a console session reads', () => {
  beforeEach(async () => {
    await useCases.setNotices({ notices: [forEveryone, forOperators, forViewers] });
  });

  it("are the operator's: those for everyone and for operators", async () => {
    const operator = await signedIn('operator');

    await expect(useCases.readNotices(operator.caller)).resolves.toEqual([forEveryone, forOperators]);
  });

  it("are a viewer's: those for everyone and for viewers", async () => {
    const viewer = await signedIn('viewer');

    await expect(useCases.readNotices(viewer.caller)).resolves.toEqual([forEveryone, forViewers]);
  });

  it('leave out a notice the session dismissed, for that session only', async () => {
    const viewer = await signedIn('viewer');
    const other = await signedIn('viewer');

    unwrap(await useCases.dismissNotice(viewer.caller, { noticeId: 'welcome' }));

    await expect(useCases.readNotices(viewer.caller)).resolves.toEqual([forEveryone]);
    await expect(useCases.readNotices(other.caller)).resolves.toEqual([forEveryone, forViewers]);
  });

  it('keep a notice dismissed when the installation sets the notices again with it', async () => {
    const viewer = await signedIn('viewer');
    unwrap(await useCases.dismissNotice(viewer.caller, { noticeId: 'welcome' }));

    await useCases.setNotices({ notices: [forViewers, forEveryone] });

    await expect(useCases.readNotices(viewer.caller)).resolves.toEqual([forEveryone]);
  });
});
