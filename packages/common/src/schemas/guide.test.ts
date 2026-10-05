import { describe, expect, it } from 'vitest';

import { GUIDE_STEP_TEXT_MAX, GUIDE_STEP_TITLE_MAX, MAX_GUIDE_STEPS, setGuideInputSchema, setGuideProgressInputSchema } from './guide.js';

// The guide (decision 0024): steps the installation sets for the sessions of
// one audience, each on a console page and pointing at an element there.

function aStep(overrides: Record<string, unknown> = {}) {
  return { path: '/', anchor: 'fleet-table', title: 'Your fleet', text: 'Every ship, its type and who crews it.', ...overrides };
}

describe('setGuideInputSchema', () => {
  it('takes a guide for an audience, its steps in order', () => {
    const guide = { audience: 'viewers', steps: [aStep(), aStep({ path: '/squadrons', anchor: 'squadrons-table', title: 'The squadron' })] };

    expect(setGuideInputSchema.parse({ guide })).toEqual({ guide });
  });

  it('takes a step without an anchor, shown centred on its page', () => {
    const centred = { path: '/', title: 'Welcome', text: 'A short tour of the console.' };

    expect(setGuideInputSchema.parse({ guide: { audience: 'everyone', steps: [centred] } }).guide?.steps).toEqual([centred]);
  });

  it('takes none, which clears the guide', () => {
    expect(setGuideInputSchema.parse({ guide: null })).toEqual({ guide: null });
  });

  it.each([
    ['an audience it does not know', { audience: 'admins', steps: [aStep()] }],
    ['no steps', { audience: 'viewers', steps: [] }],
    ['one step too many', { audience: 'viewers', steps: Array.from({ length: MAX_GUIDE_STEPS + 1 }, () => aStep()) }],
    ['a page that is no console path', { audience: 'viewers', steps: [aStep({ path: 'https://example.com/' })] }],
    ['an anchor that is no test id', { audience: 'viewers', steps: [aStep({ anchor: 'Fleet table' })] }],
    ['an empty title', { audience: 'viewers', steps: [aStep({ title: '  ' })] }],
    ['a title one character too long', { audience: 'viewers', steps: [aStep({ title: 'x'.repeat(GUIDE_STEP_TITLE_MAX + 1) })] }],
    ['a text one character too long', { audience: 'viewers', steps: [aStep({ text: 'x'.repeat(GUIDE_STEP_TEXT_MAX + 1) })] }],
  ])('refuses %s', (_case, guide) => {
    expect(setGuideInputSchema.safeParse({ guide }).success).toBe(false);
  });

  it('takes a title and a text of exactly their most characters', () => {
    const step = aStep({ title: 'x'.repeat(GUIDE_STEP_TITLE_MAX), text: 'x'.repeat(GUIDE_STEP_TEXT_MAX) });

    expect(setGuideInputSchema.safeParse({ guide: { audience: 'viewers', steps: [step] } }).success).toBe(true);
  });
});

describe('setGuideProgressInputSchema', () => {
  it.each(['open', 'skipped', 'finished'])('takes a step and the state %s', (state) => {
    expect(setGuideProgressInputSchema.parse({ step: 2, state })).toEqual({ step: 2, state });
  });

  it.each([
    ['a negative step', { step: -1, state: 'open' }],
    ['a step that is no whole number', { step: 1.5, state: 'open' }],
    ['a state it does not know', { step: 0, state: 'paused' }],
  ])('refuses %s', (_case, progress) => {
    expect(setGuideProgressInputSchema.safeParse(progress).success).toBe(false);
  });
});
