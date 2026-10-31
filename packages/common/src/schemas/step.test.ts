import { describe, expect, it } from 'vitest';

import {
  isStepContentType,
  isStepOutcomeContentType,
  isStepReplacementContentType,
  isStepWithdrawalContentType,
  STEP_CONTENT_TYPE,
  STEP_OUTCOME_CONTENT_TYPE,
  STEP_REPLACEMENT_CONTENT_TYPE,
  STEP_WITHDRAWAL_CONTENT_TYPE,
  stepOutcomeSchema,
  stepReplacementSchema,
  stepSchema,
  stepWithdrawalSchema,
} from './step.js';

const STEP_ID = '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47';
const REPLACEMENT_ID = '9b2e4d6f-1a3c-4e5b-8d7f-0c2a4e6b8d1f';

function aStep(overrides: Record<string, unknown> = {}) {
  return {
    id: STEP_ID,
    title: 'Create the GitHub repository',
    why: 'The gateway needs a repository to push to.',
    link: 'https://github.com/new',
    ...overrides,
  };
}

describe('the step content types', () => {
  it('names a step application/vnd.aeolus.step+json', () => {
    expect(STEP_CONTENT_TYPE).toBe('application/vnd.aeolus.step+json');
  });

  it('names a step outcome application/vnd.aeolus.step-outcome+json', () => {
    expect(STEP_OUTCOME_CONTENT_TYPE).toBe('application/vnd.aeolus.step-outcome+json');
  });

  it('names a withdrawal application/vnd.aeolus.step-withdrawal+json', () => {
    expect(STEP_WITHDRAWAL_CONTENT_TYPE).toBe('application/vnd.aeolus.step-withdrawal+json');
  });

  it('names a replacement application/vnd.aeolus.step-replacement+json', () => {
    expect(STEP_REPLACEMENT_CONTENT_TYPE).toBe('application/vnd.aeolus.step-replacement+json');
  });

  it.each([
    ['the type itself', 'application/vnd.aeolus.step+json'],
    ['in any case', 'Application/VND.Aeolus.Step+JSON'],
    ['with parameters', 'application/vnd.aeolus.step+json; charset=utf-8'],
  ])('knows a step: %s', (_, contentType) => {
    expect(isStepContentType(contentType)).toBe(true);
  });

  it('knows an outcome, a withdrawal and a replacement in any case and with parameters', () => {
    expect([
      isStepOutcomeContentType('Application/VND.Aeolus.Step-Outcome+JSON; charset=utf-8'),
      isStepWithdrawalContentType('Application/VND.Aeolus.Step-Withdrawal+JSON; charset=utf-8'),
      isStepReplacementContentType('Application/VND.Aeolus.Step-Replacement+JSON; charset=utf-8'),
    ]).toEqual([true, true, true]);
  });

  it('knows a step is none of the others, and a question is no step', () => {
    expect([
      isStepOutcomeContentType(STEP_CONTENT_TYPE),
      isStepWithdrawalContentType(STEP_CONTENT_TYPE),
      isStepReplacementContentType(STEP_CONTENT_TYPE),
      isStepContentType('application/vnd.aeolus.question+json'),
      isStepContentType(STEP_OUTCOME_CONTENT_TYPE),
    ]).toEqual([false, false, false, false, false]);
  });
});

describe('stepSchema', () => {
  it('takes its uuid, title, why and the link where it is done', () => {
    expect(stepSchema.parse(aStep())).toEqual(aStep());
  });

  it('takes a step without a link', () => {
    const withoutLink = aStep({ link: undefined });
    expect(stepSchema.parse(withoutLink)).toEqual({ ...withoutLink, link: undefined });
  });

  it('refuses an id that is not a uuid', () => {
    expect(stepSchema.safeParse(aStep({ id: 's-1' })).success).toBe(false);
  });

  it('refuses an empty title', () => {
    expect(stepSchema.safeParse(aStep({ title: '' })).success).toBe(false);
  });

  it.each([['not a URL', 'github.com/new'], ['not http(s)', 'javascript:alert(1)']])('refuses a link that is %s', (_, link) => {
    expect(stepSchema.safeParse(aStep({ link })).success).toBe(false);
  });
});

describe('stepOutcomeSchema', () => {
  it.each(['done', 'cannot'])('takes %s alone', (outcome) => {
    expect(stepOutcomeSchema.parse({ stepId: STEP_ID, outcome })).toEqual({ stepId: STEP_ID, outcome });
  });

  it.each(['done', 'cannot'])('takes %s with a note', (outcome) => {
    const answer = { stepId: STEP_ID, outcome, note: 'Signed in; it asked for read access only.' };
    expect(stepOutcomeSchema.parse(answer)).toEqual(answer);
  });

  it('refuses an outcome that is neither done nor cannot', () => {
    expect(stepOutcomeSchema.safeParse({ stepId: STEP_ID, outcome: 'later' }).success).toBe(false);
  });

  it('refuses an empty note', () => {
    expect(stepOutcomeSchema.safeParse({ stepId: STEP_ID, outcome: 'done', note: '' }).success).toBe(false);
  });

  it('refuses an outcome of an id that is not a uuid', () => {
    expect(stepOutcomeSchema.safeParse({ stepId: 's-1', outcome: 'done' }).success).toBe(false);
  });
});

describe('stepWithdrawalSchema', () => {
  it('takes the uuid of the step it withdraws', () => {
    expect(stepWithdrawalSchema.parse({ stepId: STEP_ID })).toEqual({ stepId: STEP_ID });
  });

  it('refuses an id that is not a uuid', () => {
    expect(stepWithdrawalSchema.safeParse({ stepId: 's-1' }).success).toBe(false);
  });
});

describe('stepReplacementSchema', () => {
  const replacement = { stepId: STEP_ID, step: aStep({ id: REPLACEMENT_ID }) };

  it('takes the uuid of the step it replaces and the new step', () => {
    expect(stepReplacementSchema.parse(replacement)).toEqual(replacement);
  });

  it('refuses a new step that is no step', () => {
    expect(stepReplacementSchema.safeParse({ ...replacement, step: aStep({ title: '' }) }).success).toBe(false);
  });

  it('refuses a new step with the uuid of the one it replaces', () => {
    expect(stepReplacementSchema.safeParse({ ...replacement, step: aStep() }).success).toBe(false);
  });
});
