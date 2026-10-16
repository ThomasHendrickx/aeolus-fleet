import { describe, expect, it } from 'vitest';

import { answerAttemptOf } from './answer-attempt';

const FAILED = { answer: { option: 2, note: 'Tell core first.' }, idempotencyKey: 'answer-first', failure: 'The fleet did not answer' };

describe('answerAttemptOf', () => {
  it('sends a first answer with a new key', () => {
    expect(answerAttemptOf({ previous: undefined, answer: { option: 2 }, newKey: 'answer-new' })).toEqual({ answer: { option: 2 }, idempotencyKey: 'answer-new', failure: undefined });
  });

  it('retries the same answer with the key it was sent with, so the fleet sends it once (#870)', () => {
    expect(answerAttemptOf({ previous: FAILED, answer: { option: 2, note: 'Tell core first.' }, newKey: 'answer-new' })).toEqual({
      answer: { option: 2, note: 'Tell core first.' },
      idempotencyKey: 'answer-first',
      failure: undefined,
    });
  });

  it('sends another option with a new key', () => {
    expect(answerAttemptOf({ previous: FAILED, answer: { option: 1, note: 'Tell core first.' }, newKey: 'answer-new' }).idempotencyKey).toBe('answer-new');
  });

  it('sends another note with a new key', () => {
    expect(answerAttemptOf({ previous: FAILED, answer: { option: 2 }, newKey: 'answer-new' }).idempotencyKey).toBe('answer-new');
    expect(answerAttemptOf({ previous: FAILED, answer: { note: 'Tell core first.' }, newKey: 'answer-new' }).idempotencyKey).toBe('answer-new');
  });
});
