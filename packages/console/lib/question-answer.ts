import { ANSWER_CONTENT_TYPE, inboxQuestionOf, withdrawalOf, type AnswerChoice, type DeliveryId, type InboxMessage } from '@aeolus-fleet/common';

import type { PluginAnswer } from './plugin-answer';
import type { QuestionMessage, Staleness } from './questions';

/**
 * Questions to argo as the web app's server reads and answers them (decisions
 * 0033, 0038): the fleet carries questions, answers, withdrawals and
 * replacements as any message and never reads them, so the console's server
 * parses argo's inbox for them and builds each answer. The browser gets only
 * typed questions.
 */

/**
 * Why a question is stale: the first withdrawal or replacement its asker sent
 * naming it; null while it is not, or once argo answered it.
 */
function stalenessOf({ asked, questionId }: { asked: Pick<InboxMessage, 'message'>; questionId: string }, inbox: readonly InboxMessage[]): Staleness | null {
  const withdrawals = inbox.flatMap((other) => {
    const withdrawal = other.message.sender.id === asked.message.sender.id ? withdrawalOf(other.message) : null;
    return withdrawal?.questionId === questionId ? [{ other, replacement: withdrawal.replacement }] : [];
  });
  const [first] = withdrawals.toSorted((one, another) => one.other.message.sentAt.localeCompare(another.other.message.sentAt));
  if (first === undefined) {
    return null;
  }
  const { deliveryId, message } = first.other;
  return first.replacement === null
    ? { kind: 'withdrawn', deliveryId, sentAt: message.sentAt }
    : { kind: 'replaced', deliveryId, sentAt: message.sentAt, by: { title: first.replacement.title } };
}

/** The question its asker's replacement replaces, answered or not; null for a question that replaces none in the inbox. */
function replacedBy(replacement: Pick<InboxMessage, 'message'>, inbox: readonly InboxMessage[]): QuestionMessage['replaces'] {
  const questionId = withdrawalOf(replacement.message)?.questionId;
  for (const other of inbox) {
    const question = other.message.sender.id === replacement.message.sender.id ? inboxQuestionOf({ message: other.message, replies: [] }) : null;
    if (question !== null && question.id === questionId) {
      return { deliveryId: other.deliveryId, title: question.title };
    }
  }
  return null;
}

/**
 * The questions among argo's messages, in the inbox's order: each with its
 * answer among argo's replies, why it is stale when its asker withdrew or
 * replaced it before argo answered, and the question a replacement replaces.
 */
export function questionsIn(inbox: readonly InboxMessage[]): QuestionMessage[] {
  return inbox.flatMap(({ replies, ...entry }) => {
    const question = inboxQuestionOf({ message: entry.message, replies });
    if (question === null) {
      return [];
    }
    const stale = question.answer === null ? stalenessOf({ asked: entry, questionId: question.id }, inbox) : null;
    return [{ ...entry, question, stale, replaces: replacedBy(entry, inbox) }];
  });
}

/** Why a stale question can not be answered. */
function refusalOf(stale: Staleness, asker: string): string {
  switch (stale.kind) {
    case 'withdrawn':
      return `${asker} withdrew that question`;
    case 'replaced':
      return `${asker} replaced that question; answer the new one`;
  }
}

/**
 * The reply that answers a question in argo's inbox: its payload and content
 * type, or why there is none (the message is not there or asks no question,
 * argo answered it already, its asker withdrew or replaced it, or the option
 * is not one of its own).
 */
export function answerReplyOf({
  inbox,
  deliveryId,
  answer,
}: {
  inbox: readonly InboxMessage[];
  deliveryId: DeliveryId;
  answer: AnswerChoice;
}): PluginAnswer<{ payload: string; contentType: string }> {
  if (!inbox.some((entry) => entry.deliveryId === deliveryId)) {
    return { kind: 'refused', message: 'That question is not in your inbox' };
  }
  const asked = questionsIn(inbox).find((entry) => entry.deliveryId === deliveryId);
  if (asked === undefined) {
    return { kind: 'refused', message: 'That message asks no question' };
  }
  if (asked.question.answer !== null) {
    return { kind: 'refused', message: 'You already answered that question' };
  }
  if (asked.stale !== null) {
    return { kind: 'refused', message: refusalOf(asked.stale, asked.message.sender.name) };
  }
  if ('option' in answer && !asked.question.options.some(({ key }) => key === answer.option)) {
    return { kind: 'refused', message: `The question has no option ${answer.option}` };
  }
  return { kind: 'answered', data: { payload: JSON.stringify({ questionId: asked.question.id, ...answer }), contentType: ANSWER_CONTENT_TYPE } };
}
