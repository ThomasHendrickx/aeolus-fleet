import { describe, expect, it } from 'vitest';

import { enabledModelsAskSchema, enabledModelsSchema } from './enabled-models.js';

// The examples follow the trierarch plugin's docs/design/enabled-models-for-ships.md, R1.

describe('enabledModelsAskSchema', () => {
  it('takes the empty ask', () => {
    expect(enabledModelsAskSchema.safeParse({})).toEqual({ success: true, data: {} });
  });

  it('refuses an ask that carries a field', () => {
    expect(enabledModelsAskSchema.safeParse({ harness: 'codex' }).success).toBe(false);
  });
});

describe('enabledModelsSchema', () => {
  it('takes the set of exact model ids', () => {
    const answer = { models: ['claude-opus-5-5', 'gpt-6.1-sol'] };

    expect(enabledModelsSchema.safeParse(answer)).toEqual({ success: true, data: answer });
  });

  it('takes an empty set: no rule, every model allowed', () => {
    expect(enabledModelsSchema.safeParse({ models: [] })).toEqual({ success: true, data: { models: [] } });
  });

  it.each([
    ['no models', {}],
    ['a model that is no string', { models: [5] }],
    ['an empty model id', { models: [''] }],
    ['a model id with a space', { models: ['claude opus'] }],
    ['an unknown field', { models: [], harness: 'codex' }],
  ])('refuses %s', (_name, answer) => {
    expect(enabledModelsSchema.safeParse(answer).success).toBe(false);
  });
});
