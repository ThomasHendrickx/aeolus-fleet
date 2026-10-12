import { describe, expect, it } from 'vitest';

import { TURN_STATES, turnInputSchema, turnOutputSchema } from './turn.js';

describe('TURN_STATES', () => {
  it('are idle and busy, nothing else', () => {
    expect(TURN_STATES).toEqual(['idle', 'busy']);
  });
});

describe('turnInputSchema', () => {
  it('takes the turn and the time the hook saw it, in ISO 8601', () => {
    const input = { turn: 'busy', at: '2026-10-12T12:00:00.000Z' };

    expect(turnInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['another turn', { turn: 'working', at: '2026-10-12T12:00:00.000Z' }],
    ['no time', { turn: 'idle' }],
    ['a time that is not ISO 8601', { turn: 'idle', at: '12 Oct 2026' }],
  ])('rejects %s', (_label, input) => {
    expect(turnInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('turnOutputSchema', () => {
  it('answers nothing: the OK is the answer', () => {
    expect(turnOutputSchema.safeParse({}).success).toBe(true);
    expect(turnOutputSchema.safeParse({ turn: 'idle' }).success).toBe(false);
  });
});
