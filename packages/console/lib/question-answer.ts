import { ANSWER_CONTENT_TYPE, inboxQuestionOf, type AnswerChoice, type InboxMessage } from '@aeolus-fleet/common';

import type { PluginAnswer } from './plugin-answer';
import type { QuestionMessage } from './questions';

/**
 * Questions to argo as the web app's server reads and answers them (decisions
 * 0033, 0038): the fleet carries questions and answers as any message and
 * never reads them, so the console's server parses argo's inbox for them and
 * builds each answer. The browser gets only typed questions.
 */

/** The questions among argo's messages, each with its answer among argo's replies, in the inbox's order. */
export function questionsIn(inbox: readonly InboxMessage[]): QuestionMessage[] {
  return inbox.flatMap(({ replies, ...entry }) => {
    const question = inboxQuestionOf({ message: entry.message, replies });
    return question === null ? [] : [{ ...entry, question }];
  });
}

/**
 * The reply that answers a question: its payload and content type, or why
 * there is none (the message asks no question, or the option is not one of
 * its own).
 */
export function answerReplyOf(entry: InboxMessage, choice: AnswerChoice): PluginAnswer<{ payload: string; contentType: string }> {
  const question = inboxQuestionOf({ message: entry.message, replies: [] });
  if (question === null) {
    return { kind: 'refused', message: 'That message asks no question' };
  }
  if ('option' in choice && !question.options.some(({ key }) => key === choice.option)) {
    return { kind: 'refused', message: `The question has no option ${choice.option}` };
  }
  return { kind: 'answered', data: { payload: JSON.stringify({ questionId: question.id, ...choice }), contentType: ANSWER_CONTENT_TYPE } };
}
