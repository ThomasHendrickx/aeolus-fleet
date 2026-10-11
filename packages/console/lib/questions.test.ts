import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { questionDeliveryIdsOf, questionFilterCounts, questionsFor, questionsPathOf, readQuestionFilter } from './questions';

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

const open = { id: 'b', question: aQuestion(null), stale: null };
const answered = { id: 'c', question: aQuestion({ option: 1 }), stale: null };
const withdrawn = { id: 'd', question: aQuestion(null), stale: { kind: 'withdrawn' as const } };
const messages = [open, answered, withdrawn];

describe('questionsFor', () => {
  it('keeps the questions not answered yet and not stale for Open', () => {
    expect(questionsFor(messages, 'open')).toEqual([open]);
  });

  it('keeps the answered ones for Answered', () => {
    expect(questionsFor(messages, 'answered')).toEqual([answered]);
  });

  it('keeps the withdrawn and replaced ones for Stale', () => {
    expect(questionsFor(messages, 'stale')).toEqual([withdrawn]);
  });

  it('keeps every question for All', () => {
    expect(questionsFor(messages, 'all')).toEqual([open, answered, withdrawn]);
  });
});

describe('questionDeliveryIdsOf', () => {
  it('names the deliveries of the questions and of the withdrawals that made one stale, which the inbox leaves out', () => {
    const [asked, withdrawal, replacement, replaced] = [newId('delivery'), newId('delivery'), newId('delivery'), newId('delivery')];
    const questions = [
      { deliveryId: asked, stale: { kind: 'withdrawn' as const, deliveryId: withdrawal } },
      { deliveryId: replacement, stale: null },
      { deliveryId: replaced, stale: { kind: 'replaced' as const, deliveryId: replacement } },
    ];

    expect(questionDeliveryIdsOf(questions)).toEqual(new Set([asked, withdrawal, replacement, replaced]));
  });
});

describe('questionFilterCounts', () => {
  it('counts each filter', () => {
    expect(questionFilterCounts(messages)).toEqual({ open: 1, answered: 1, stale: 1, all: 3 });
  });
});

describe('readQuestionFilter', () => {
  it.each([
    [undefined, 'open'],
    ['answered', 'answered'],
    ['stale', 'stale'],
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
