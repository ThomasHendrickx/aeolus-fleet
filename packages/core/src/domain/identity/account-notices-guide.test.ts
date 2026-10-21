import { accountIdSchema, type FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleetWithViewer, identityUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { AccountCaller } from '../shared/caller.js';
import type { Guide } from './guide.js';
import type { Notice } from './notice.js';

// Notices and the guide for an account signed in to the console as itself
// (accounts design, A9): the audience `accounts` beside everyone's, and its
// dismissals and guide progress kept by its account id, in each fleet.

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let fleetId: FleetId;
let mathilde: AccountCaller;
let burak: AccountCaller;

function aNotice(overrides: Partial<Notice> = {}): Notice {
  return { id: 'upgrade', audience: 'everyone', text: 'Interruptions expected between 00:00 and 01:00.', links: [], isDismissible: false, ...overrides };
}

const forEveryone = aNotice();
const forOperators = aNotice({ id: 'limits', audience: 'operators', text: 'Your fleet is near its ship limit.' });
const forAccounts = aNotice({ id: 'teams', audience: 'accounts', text: 'Your organisation now signs in with its own accounts.', isDismissible: true });

const steps: Guide['steps'] = [
  { path: '/', anchor: 'fleet-table', title: 'Your fleet', text: 'Every ship, its type and who crews it.' },
  { path: '/inbox', anchor: 'inbox-list', title: 'Messages', text: 'What reaches argo.' },
];

function anAccount(id: string): AccountCaller {
  return { kind: 'account', accountId: accountIdSchema.parse(id), fleetId, scopes: ['fleet:read'], groupValues: [], personShipId: null, throughShipId: null };
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-21T09:00:00.000Z');
  useCases = identityUseCases(core);
  ({ fleetId } = await hostedFleetWithViewer(core));
  mathilde = anAccount('acc-mathilde');
  burak = anAccount('acc-burak');
});

describe('the notices an account reads', () => {
  beforeEach(async () => {
    await useCases.setNotices({ notices: [forEveryone, forOperators, forAccounts] });
  });

  it("are those for everyone and for accounts, never the operators'", async () => {
    await expect(useCases.readNotices(mathilde)).resolves.toEqual([forEveryone, forAccounts]);
  });

  it('lose one it dismissed, for that account alone', async () => {
    unwrap(await useCases.dismissNotice(mathilde, { noticeId: 'teams' }));

    await expect(useCases.readNotices(mathilde)).resolves.toEqual([forEveryone]);
    await expect(useCases.readNotices(burak)).resolves.toEqual([forEveryone, forAccounts]);
  });

  it("refuses dismissing one not for accounts, as for any session outside the notice's audience", async () => {
    await expect(useCases.dismissNotice(mathilde, { noticeId: 'limits' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOTICE_NOT_FOUND' } });
  });
});

describe('the guide an account reads', () => {
  it('is the guide for accounts, at the first step until it moves on', async () => {
    await useCases.setGuide({ guide: { audience: 'accounts', steps } });

    await expect(useCases.readGuide(mathilde)).resolves.toEqual({ steps, progress: { step: 0, state: 'open' } });
  });

  it("keeps where each account is, by its id", async () => {
    await useCases.setGuide({ guide: { audience: 'everyone', steps } });

    unwrap(await useCases.recordGuideProgress(mathilde, { step: 1, state: 'open' }));

    await expect(useCases.readGuide(mathilde)).resolves.toMatchObject({ progress: { step: 1, state: 'open' } });
    await expect(useCases.readGuide(burak)).resolves.toMatchObject({ progress: { step: 0, state: 'open' } });
  });

  it("is none for an account when the guide is the operators'", async () => {
    await useCases.setGuide({ guide: { audience: 'operators', steps } });

    await expect(useCases.readGuide(mathilde)).resolves.toBeNull();
  });
});
