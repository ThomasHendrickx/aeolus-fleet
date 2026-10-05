import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleetWithViewer, identityUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Notice } from './notice.js';
import type { SignedIn } from './sign-in.js';

// A console session dismisses a dismissible notice for itself (decision
// 0023).

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


describe('dismissing a notice', () => {
  beforeEach(async () => {
    await useCases.setNotices({ notices: [forEveryone, forOperators, forViewers] });
  });

  it('is refused for a notice that is not dismissible', async () => {
    const operator = await signedIn('operator');

    await expect(useCases.dismissNotice(operator.caller, { noticeId: 'upgrade' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOTICE_NOT_DISMISSIBLE' } });
  });

  it("is refused for a notice the session does not see: none set, or another audience's", async () => {
    const operator = await signedIn('operator');

    await expect(useCases.dismissNotice(operator.caller, { noticeId: 'welcome' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOTICE_NOT_FOUND' } });
    await expect(useCases.dismissNotice(operator.caller, { noticeId: 'gone' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOTICE_NOT_FOUND' } });
  });

  it('again is OK and changes nothing', async () => {
    const viewer = await signedIn('viewer');
    unwrap(await useCases.dismissNotice(viewer.caller, { noticeId: 'welcome' }));

    await expect(useCases.dismissNotice(viewer.caller, { noticeId: 'welcome' })).resolves.toEqual({ isOk: true, value: undefined });
    await expect(useCases.readNotices(viewer.caller)).resolves.toEqual([forEveryone]);
  });

  it('writes no event: a notice is how the console looks, not a change to the fleet', async () => {
    const viewer = await signedIn('viewer');
    const before = core.state.events.length;

    unwrap(await useCases.dismissNotice(viewer.caller, { noticeId: 'welcome' }));

    expect(core.state.events).toHaveLength(before);
  });
});
