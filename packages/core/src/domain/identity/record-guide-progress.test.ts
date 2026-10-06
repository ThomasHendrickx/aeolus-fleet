import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleetWithViewer, identityUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Guide } from './guide.js';
import type { SignedIn } from './sign-in.js';

// A console session records where it is in the guide (decision 0024): a step,
// and whether the guide is open, skipped or finished.

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let fleetId: FleetId;

const steps: Guide['steps'] = [
  { path: '/', anchor: 'fleet-table', title: 'Your fleet', text: 'Every ship, its type and who crews it.' },
  { path: '/squadrons', title: 'The squadron', text: 'A team of ships formed from a blueprint.' },
];

beforeEach(async () => {
  core = createInMemoryCore('2026-10-05T09:00:00.000Z');
  useCases = identityUseCases(core);
  ({ fleetId } = await hostedFleetWithViewer(core));
  await useCases.setGuide({ guide: { audience: 'viewers', steps } });
});

async function signedIn(as: 'operator' | 'viewer'): Promise<SignedIn> {
  const { ticket } = unwrap(await useCases.issueSignInTicket({ fleetId, as }));
  return unwrap(await useCases.redeemSignInTicket({ ticket, device: 'Mac · Safari' }));
}

describe('recording progress in the guide', () => {
  it.each(['skipped', 'finished'] as const)('keeps the guide %s for the session', async (state) => {
    const viewer = await signedIn('viewer');

    unwrap(await useCases.recordGuideProgress(viewer.caller, { step: 1, state }));

    await expect(useCases.readGuide(viewer.caller)).resolves.toEqual({ steps, progress: { step: 1, state } });
  });

  it('opens it again at the first step, as Take the tour does after Skip or Finish', async () => {
    const viewer = await signedIn('viewer');
    unwrap(await useCases.recordGuideProgress(viewer.caller, { step: 1, state: 'skipped' }));

    unwrap(await useCases.recordGuideProgress(viewer.caller, { step: 0, state: 'open' }));

    await expect(useCases.readGuide(viewer.caller)).resolves.toEqual({ steps, progress: { step: 0, state: 'open' } });
  });

  it('is refused a step the guide does not have', async () => {
    const viewer = await signedIn('viewer');

    await expect(useCases.recordGuideProgress(viewer.caller, { step: 2, state: 'open' })).resolves.toMatchObject({ isOk: false, error: { kind: 'GUIDE_STEP_NOT_FOUND' } });
  });

  it("is refused for a session the guide is not for: another audience's, or with no guide set", async () => {
    const operator = await signedIn('operator');
    await expect(useCases.recordGuideProgress(operator.caller, { step: 0, state: 'open' })).resolves.toMatchObject({ isOk: false, error: { kind: 'GUIDE_NOT_FOUND' } });

    await useCases.setGuide({ guide: null });
    const viewer = await signedIn('viewer');
    await expect(useCases.recordGuideProgress(viewer.caller, { step: 0, state: 'open' })).resolves.toMatchObject({ isOk: false, error: { kind: 'GUIDE_NOT_FOUND' } });
  });

  it('writes no event: the guide is how the console looks, not a change to the fleet', async () => {
    const viewer = await signedIn('viewer');
    const before = core.state.events.length;

    unwrap(await useCases.recordGuideProgress(viewer.caller, { step: 1, state: 'open' }));

    expect(core.state.events).toHaveLength(before);
  });
});
