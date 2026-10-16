import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { answerLabelOf, neighbourOf, questionPositionOf } from './inbox-moves';

const newId = createIdGenerator();
const [first, second, third] = [newId('delivery'), newId('delivery'), newId('delivery')];
const ORDER = [first, second, third];

describe('answerLabelOf', () => {
  it('names the option an answer sends', () => {
    expect(answerLabelOf({ option: '14 days', hasNote: false })).toBe('Answer: 14 days');
  });

  it('says a note goes with the option', () => {
    expect(answerLabelOf({ option: '30 days', hasNote: true })).toBe('Answer: 30 days, with note');
  });

  it('sends a note alone without an option', () => {
    expect(answerLabelOf({ option: undefined, hasNote: true })).toBe('Send note');
  });

  it('has nothing to send without an option or a note', () => {
    expect(answerLabelOf({ option: undefined, hasNote: false })).toBeUndefined();
  });
});

describe('neighbourOf', () => {
  it('moves to the next row', () => {
    expect(neighbourOf(ORDER, first, 'next')).toBe(second);
  });

  it('moves to the previous row', () => {
    expect(neighbourOf(ORDER, second, 'previous')).toBe(first);
  });

  it('stays at the last row going on', () => {
    expect(neighbourOf(ORDER, third, 'next')).toBe(third);
  });

  it('stays at the first row going back', () => {
    expect(neighbourOf(ORDER, first, 'previous')).toBe(first);
  });

  it('starts at the first row with none open', () => {
    expect(neighbourOf(ORDER, undefined, 'next')).toBe(first);
  });

  it('is undefined in an empty list', () => {
    expect(neighbourOf([], undefined, 'next')).toBeUndefined();
  });
});

describe('questionPositionOf', () => {
  it('says where an open question stands and which one follows', () => {
    expect(questionPositionOf(ORDER, second)).toEqual({ number: 2, count: 3, next: third, left: 2 });
  });

  it('goes on from the first open question after the last one', () => {
    expect(questionPositionOf(ORDER, third)).toEqual({ number: 3, count: 3, next: first, left: 2 });
  });

  it('offers the first open question after one that is no longer open', () => {
    expect(questionPositionOf(ORDER, newId('delivery'))).toEqual({ number: undefined, count: 3, next: first, left: 3 });
  });

  it('offers none when no other question is open', () => {
    expect(questionPositionOf([first], first)).toEqual({ number: 1, count: 1, next: undefined, left: 0 });
  });
});
