import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleetWithViewer, identityUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Guide } from './guide.js';
import type { SignedIn } from './sign-in.js';

// The guide a console session reads (decision 0024): the installation's, when
// it is for the session's audience, with where the session is in it.

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let fleetId: FleetId;

const steps: Guide['steps'] = [
  { path: '/', anchor: 'fleet-table', title: 'Your fleet', text: 'Every ship, its type and who crews it.' },
  { path: '/inbox', anchor: 'inbox-list', title: 'Messages', text: 'What reaches argo.' },
  { path: '/squadrons', title: 'The squadron', text: 'A team of ships formed from a blueprint.' },
];

beforeEach(async () => {
  core = createInMemoryCore('2026-10-05T09:00:00.000Z');
  useCases = identityUseCases(core);
  ({ fleetId } = await hostedFleetWithViewer(core));
});

async function signedIn(as: 'operator' | 'viewer'): Promise<SignedIn> {
  const { ticket } = unwrap(await useCases.issueSignInTicket({ fleetId, as }));
  return unwrap(await useCases.redeemSignInTicket({ ticket, device: 'Mac · Safari' }));
}

describe('the guide a console session reads', () => {
  it('is none while the installation sets no guide', async () => {
    await expect(useCases.readGuide((await signedIn('operator')).caller)).resolves.toBeNull();
  });

  it("is none for a session outside the guide's audience", async () => {
    await useCases.setGuide({ guide: { audience: 'viewers', steps } });

    await expect(useCases.readGuide((await signedIn('operator')).caller)).resolves.toBeNull();
  });

  it('opens at its first step for a session that has not moved in it yet', async () => {
    await useCases.setGuide({ guide: { audience: 'viewers', steps } });

    await expect(useCases.readGuide((await signedIn('viewer')).caller)).resolves.toEqual({ steps, progress: { step: 0, state: 'open' } });
  });

  it('reaches everyone: the operator and viewers', async () => {
    await useCases.setGuide({ guide: { audience: 'everyone', steps } });

    await expect(useCases.readGuide((await signedIn('operator')).caller)).resolves.toMatchObject({ steps });
    await expect(useCases.readGuide((await signedIn('viewer')).caller)).resolves.toMatchObject({ steps });
  });

  it('keeps where the session is, for that session only: a new session opens it at the start again', async () => {
    await useCases.setGuide({ guide: { audience: 'viewers', steps } });
    const viewer = await signedIn('viewer');
    unwrap(await useCases.recordGuideProgress(viewer.caller, { step: 1, state: 'open' }));

    await expect(useCases.readGuide(viewer.caller)).resolves.toEqual({ steps, progress: { step: 1, state: 'open' } });
    await expect(useCases.readGuide((await signedIn('viewer')).caller)).resolves.toEqual({ steps, progress: { step: 0, state: 'open' } });
  });

  it('reads a step past the end of a shorter guide set since as its last step', async () => {
    await useCases.setGuide({ guide: { audience: 'viewers', steps } });
    const viewer = await signedIn('viewer');
    unwrap(await useCases.recordGuideProgress(viewer.caller, { step: 2, state: 'open' }));

    await useCases.setGuide({ guide: { audience: 'viewers', steps: steps.slice(0, 2) } });

    await expect(useCases.readGuide(viewer.caller)).resolves.toEqual({ steps: steps.slice(0, 2), progress: { step: 1, state: 'open' } });
  });
});
