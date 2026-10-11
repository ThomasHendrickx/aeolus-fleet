import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { questionFilterCounts, questionsFor, questionsOf, questionsPathOf, readQuestionFilter } from './questions';

const newId = createIdGenerator();

function aQuestion(answer: { option: number } | null) {
  return {
    id: '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47',
    title: 'Which port?',
    context: '',
    options: [{ key: 1, label: 'Keep 3000', detail: '' }],
    pick: { option: 1, why: 'Nothing else needs it.' },
    answer: answer === null ? null : { messageId: newId('message'), sentAt: '2026-10-11T09:00:00.000Z', note: null, ...answer },
  };
}

const plain = { id: 'a', question: null };
const open = { id: 'b', question: aQuestion(null) };
const answered = { id: 'c', question: aQuestion({ option: 1 }) };
const messages = [plain, open, answered];

describe('questionsOf', () => {
  it('keeps the messages that ask a question, in order', () => {
    expect(questionsOf(messages)).toEqual([open, answered]);
  });
});

describe('questionsFor', () => {
  it('keeps the questions not answered yet for Open', () => {
    expect(questionsFor(messages, 'open')).toEqual([open]);
  });

  it('keeps the answered ones for Answered', () => {
    expect(questionsFor(messages, 'answered')).toEqual([answered]);
  });

  it('keeps every question for All', () => {
    expect(questionsFor(messages, 'all')).toEqual([open, answered]);
  });
});

describe('questionFilterCounts', () => {
  it('counts each filter, plain messages left out', () => {
    expect(questionFilterCounts(messages)).toEqual({ open: 1, answered: 1, all: 2 });
  });
});

describe('readQuestionFilter', () => {
  it.each([
    [undefined, 'open'],
    ['answered', 'answered'],
    ['all', 'all'],
    ['done', 'open'],
  ] as const)('reads %s as %s', (value, filter) => {
    expect(readQuestionFilter(value)).toBe(filter);
  });
});

describe('questionsPathOf', () => {
  it('is /questions for Open without a question', () => {
    expect(questionsPathOf({ filter: 'open' })).toBe('/questions');
  });

  it('keeps another filter and the open question in the URL', () => {
    const deliveryId = newId('delivery');

    expect(questionsPathOf({ filter: 'answered', deliveryId })).toBe(`/questions?filter=answered&question=${deliveryId}`);
  });
});
