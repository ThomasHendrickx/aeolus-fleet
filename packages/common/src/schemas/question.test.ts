import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  ANSWER_CONTENT_TYPE,
  answerSchema,
  inboxQuestionOf,
  isAnswerContentType,
  isQuestionContentType,
  QUESTION_CONTENT_TYPE,
  questionSchema,
} from './question.js';

const newId = createIdGenerator();

const QUESTION_ID = '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47';

function aQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: QUESTION_ID,
    title: 'Which port does the console use?',
    context: 'The docs name two ports.',
    options: [
      { key: 1, label: 'Keep 3000', detail: 'What the console uses now.' },
      { key: 2, label: 'Move to 4000', detail: 'Frees 3000 for core.' },
    ],
    pick: { option: 1, why: 'Nothing else needs 3000.' },
    ...overrides,
  };
}

describe('the content types', () => {
  it('names a question application/vnd.aeolus.question+json', () => {
    expect(QUESTION_CONTENT_TYPE).toBe('application/vnd.aeolus.question+json');
  });

  it('names an answer application/vnd.aeolus.answer+json', () => {
    expect(ANSWER_CONTENT_TYPE).toBe('application/vnd.aeolus.answer+json');
  });

  it.each([
    ['the type itself', 'application/vnd.aeolus.question+json'],
    ['in any case', 'Application/VND.Aeolus.Question+JSON'],
    ['with parameters', 'application/vnd.aeolus.question+json; charset=utf-8'],
  ])('knows a question: %s', (_, contentType) => {
    expect(isQuestionContentType(contentType)).toBe(true);
  });

  it.each([
    ['plain JSON', 'application/json'],
    ['an answer', 'application/vnd.aeolus.answer+json'],
  ])('knows what is not a question: %s', (_, contentType) => {
    expect(isQuestionContentType(contentType)).toBe(false);
  });

  it('knows an answer with parameters', () => {
    expect(isAnswerContentType('application/vnd.aeolus.answer+json; charset=utf-8')).toBe(true);
  });

  it('knows a question is not an answer', () => {
    expect(isAnswerContentType(QUESTION_CONTENT_TYPE)).toBe(false);
  });
});

describe('questionSchema', () => {
  it('takes its uuid, title, context, numbered options and the asker’s pick and why', () => {
    expect(questionSchema.parse(aQuestion())).toEqual(aQuestion());
  });

  it('refuses an id that is not a uuid', () => {
    expect(questionSchema.safeParse(aQuestion({ id: 'q-1' })).success).toBe(false);
  });

  it('refuses an empty title', () => {
    expect(questionSchema.safeParse(aQuestion({ title: '' })).success).toBe(false);
  });

  it('refuses a question without options', () => {
    expect(questionSchema.safeParse(aQuestion({ options: [] })).success).toBe(false);
  });

  it('refuses an option numbered below 1', () => {
    const options = [{ key: 0, label: 'Zero', detail: '' }];
    expect(questionSchema.safeParse(aQuestion({ options, pick: { option: 0, why: 'Only one.' } })).success).toBe(false);
  });

  it('refuses two options with the same number', () => {
    const options = [
      { key: 1, label: 'One', detail: '' },
      { key: 1, label: 'Also one', detail: '' },
    ];
    expect(questionSchema.safeParse(aQuestion({ options })).success).toBe(false);
  });

  it('refuses a pick that names no option', () => {
    expect(questionSchema.safeParse(aQuestion({ pick: { option: 3, why: 'Neither.' } })).success).toBe(false);
  });
});

describe('answerSchema', () => {
  it('takes one option and a note', () => {
    const answer = { questionId: QUESTION_ID, option: 2, note: 'Tell core first.' };
    expect(answerSchema.parse(answer)).toEqual(answer);
  });

  it('takes one option alone', () => {
    const answer = { questionId: QUESTION_ID, option: 2 };
    expect(answerSchema.parse(answer)).toEqual(answer);
  });

  it('takes a note alone', () => {
    const answer = { questionId: QUESTION_ID, note: 'Which docs?' };
    expect(answerSchema.parse(answer)).toEqual(answer);
  });

  it('refuses an answer with neither an option nor a note', () => {
    expect(answerSchema.safeParse({ questionId: QUESTION_ID }).success).toBe(false);
  });

  it('refuses an empty note alone', () => {
    expect(answerSchema.safeParse({ questionId: QUESTION_ID, note: '' }).success).toBe(false);
  });

  it('refuses an answer to an id that is not a uuid', () => {
    expect(answerSchema.safeParse({ questionId: 'q-1', option: 1 }).success).toBe(false);
  });
});

describe('inboxQuestionOf', () => {
  const sentAt = new Date('2026-10-11T09:00:00.000Z');

  function aReply(overrides: Partial<{ contentType: string; payload: string }> = {}) {
    return {
      id: newId('message'),
      contentType: ANSWER_CONTENT_TYPE,
      payload: JSON.stringify({ questionId: QUESTION_ID, option: 2, note: 'Tell core first.' }),
      sentAt,
      ...overrides,
    };
  }

  const asked = { contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(aQuestion()) };

  it('reads an open question from a message of the question type', () => {
    expect(inboxQuestionOf({ message: asked, replies: [] })).toEqual({ ...aQuestion(), answer: null });
  });

  it('is no question for a message of another type', () => {
    expect(inboxQuestionOf({ message: { ...asked, contentType: 'application/json' }, replies: [] })).toBeNull();
  });

  it('is no question when the payload is not JSON', () => {
    expect(inboxQuestionOf({ message: { ...asked, payload: 'Which port?' }, replies: [] })).toBeNull();
  });

  it('is no question when the payload is not a question', () => {
    expect(inboxQuestionOf({ message: { ...asked, payload: '{"title":"Which port?"}' }, replies: [] })).toBeNull();
  });

  it('is answered by a reply of the answer type naming it', () => {
    const reply = aReply();
    expect(inboxQuestionOf({ message: asked, replies: [reply] })?.answer).toEqual({
      messageId: reply.id,
      sentAt,
      option: 2,
      note: 'Tell core first.',
    });
  });

  it('is answered by a note alone', () => {
    const reply = aReply({ payload: JSON.stringify({ questionId: QUESTION_ID, note: 'Which docs?' }) });
    expect(inboxQuestionOf({ message: asked, replies: [reply] })?.answer).toEqual({
      messageId: reply.id,
      sentAt,
      option: null,
      note: 'Which docs?',
    });
  });

  it('stays open after a plain reply', () => {
    const reply = aReply({ contentType: 'text/plain', payload: 'Looking into it.' });
    expect(inboxQuestionOf({ message: asked, replies: [reply] })?.answer).toBeNull();
  });

  it('stays open after an answer to another question', () => {
    const reply = aReply({ payload: JSON.stringify({ questionId: '0a7d3c1e-2b4f-4c6a-8e9d-1f3b5a7c9e2d', option: 1 }) });
    expect(inboxQuestionOf({ message: asked, replies: [reply] })?.answer).toBeNull();
  });

  it('shows the first answer when there are several', () => {
    const first = aReply();
    const second = aReply({ payload: JSON.stringify({ questionId: QUESTION_ID, option: 1 }) });
    expect(inboxQuestionOf({ message: asked, replies: [first, second] })?.answer?.messageId).toBe(first.id);
  });
});
