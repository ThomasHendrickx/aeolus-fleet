import type { AnswerChoice } from '@aeolus-fleet/common';

/**
 * An answer to a question as the inbox sends it (#870): what it says, the
 * idempotency key it goes with, and why it was not sent, while it was not.
 * Retrying the same answer keeps its key, so a send that did reach the fleet
 * is never sent twice.
 */
export interface AnswerAttempt {
  answer: AnswerChoice;
  idempotencyKey: string;
  failure: string | undefined;
}

function isSameAnswer(one: AnswerChoice, another: AnswerChoice): boolean {
  const optionOf = (answer: AnswerChoice) => ('option' in answer ? answer.option : undefined);
  return optionOf(one) === optionOf(another) && one.note === another.note;
}

/** The attempt that sends an answer: the previous attempt's key when it said the same, a new key otherwise. */
export function answerAttemptOf({ previous, answer, newKey }: { previous: AnswerAttempt | undefined; answer: AnswerChoice; newKey: string }): AnswerAttempt {
  const idempotencyKey = previous !== undefined && isSameAnswer(previous.answer, answer) ? previous.idempotencyKey : newKey;
  return { answer, idempotencyKey, failure: undefined };
}
