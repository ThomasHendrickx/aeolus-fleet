import type { Question, Step } from '@aeolus-fleet/common';

/** A schema-valid question with non-consecutive option keys and empty context. */
export function aQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Ship it?',
    context: '',
    options: [{ key: 2, label: 'Ship', detail: '' }, { key: 4, label: 'Wait', detail: '' }],
    pick: { option: 2, why: 'Ready' },
    ...overrides,
  };
}

/** A schema-valid step whose why may be empty. */
export function aStep(overrides: Partial<Step> = {}): Step {
  return { id: '22222222-2222-4222-8222-222222222222', title: 'Sign in', why: '', ...overrides };
}
