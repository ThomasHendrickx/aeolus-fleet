import {
  ANSWER_CONTENT_TYPE,
  inboxQuestionOf,
  type AnswerChoice,
  type DeliveryId,
  type IdGenerator,
  type MessageId,
} from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { RequestHasher } from './ports.js';
import { repliedToWithin, replyWithin, type ReplyToMessageRefusal, type ReplyToMessageTx } from './reply-to-message.js';

export type AnswerQuestionRefusal = ReplyToMessageRefusal | DomainError<'NOT_A_QUESTION' | 'UNKNOWN_OPTION'>;

export type AnswerQuestion = (
  crew: Crew,
  input: { deliveryId: DeliveryId; answer: AnswerChoice; idempotencyKey: string },
) => Promise<Result<{ messageId: MessageId }, AnswerQuestionRefusal>>;

/**
 * Use case: argo answers a question a ship asked it (decision 0038). Its
 * scopes (messages:send and messages:receive) are checked before this runs.
 * The answer is a reply, as Reply sends one, of the answer content type: the
 * question's uuid and one of its options with an optional note, or a note
 * alone. A message that is no question, or an option the question does not
 * have, sends nothing.
 */
export function createAnswerQuestion(deps: {
  uow: UnitOfWork<ReplyToMessageTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
}): AnswerQuestion {
  return async (crew, input) => {
    if (crew.kind !== 'operator') {
      return refuse('NOT_THE_OPERATOR_SHIP', 'Only argo answers questions from the console; a ship sends its answer');
    }
    return deps.uow.run(async (tx): Promise<Result<{ messageId: MessageId }, AnswerQuestionRefusal>> => {
      const found = await repliedToWithin(tx, { fleetId: crew.fleetId, crew, deliveryId: input.deliveryId });
      if (!found.isOk) {
        return found;
      }
      const question = inboxQuestionOf({ message: found.value.asked, replies: [] });
      if (question === null) {
        return refuse('NOT_A_QUESTION', `Delivery ${input.deliveryId} carries no question`);
      }
      const { answer } = input;
      if ('option' in answer && !question.options.some(({ key }) => key === answer.option)) {
        return refuse('UNKNOWN_OPTION', `The question has no option ${answer.option}`);
      }
      return replyWithin(
        { tx, clock: deps.clock, ids: deps.ids, hasher: deps.hasher },
        {
          crew,
          ...found.value,
          payload: JSON.stringify({ questionId: question.id, ...answer }),
          contentType: ANSWER_CONTENT_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      );
    });
  };
}
