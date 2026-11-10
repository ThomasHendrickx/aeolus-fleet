import {
  QUESTION_CONTENT_TYPE,
  STEP_CONTENT_TYPE,
  STEP_WITHDRAWAL_CONTENT_TYPE,
  WITHDRAWAL_CONTENT_TYPE,
  type Question,
  type Step,
  type WithdrawalTarget,
} from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { Result } from '../shared/result.js';
import type { RecipientSelector } from '../shared/selector.js';
import { createSendMessage, type MessageSent, type SendMessageRefusal } from './send-message.js';

/** A question, a step, or the withdrawal of one, by its uuid: the formatted messages core builds (docs/design/ask-and-step). */
export type FormattedMessage =
  | { kind: 'question'; question: Question }
  | { kind: 'step'; step: Step }
  | { kind: 'withdrawal'; target: WithdrawalTarget };

export interface FormattedMessageToSend {
  /** One ship, by id or by name: never the owner resolved for the caller, so a retry addresses the same ship. */
  selector: Extract<RecipientSelector, { kind: 'ship' }>;
  message: FormattedMessage;
  /** The exact model the sender's session runs: every ship but argo states it. */
  model?: string;
  idempotencyKey: string;
}

export type SendFormattedMessage = (caller: ShipCaller, input: FormattedMessageToSend) => Promise<Result<MessageSent, SendMessageRefusal>>;

/**
 * Use case: the calling ship asks one ship a question, asks it for a step, or
 * withdraws one (`ask`, `step`, `withdraw`). Core builds the JSON and fixes
 * its content type, then sends it as `send` does: the same scopes, model rule,
 * 256 KB limit on the built JSON, sealing, idempotency and durable commit
 * before the id is answered. Fields are written in one order, defaults
 * included, so a retry with the same fields is the same request. A withdrawal
 * names only the uuid: core looks up no original and tracks no open state;
 * the recipient decides whether it applies.
 */
export function createSendFormattedMessage(deps: Parameters<typeof createSendMessage>[0]): SendFormattedMessage {
  const sendMessage = createSendMessage(deps);
  return (caller, { selector, message, model, idempotencyKey }) =>
    sendMessage(caller, { selector, model, idempotencyKey, ...carried(message) });
}

/** The payload and content type a formatted message is carried as. */
function carried(message: FormattedMessage): { payload: string; contentType: string } {
  switch (message.kind) {
    case 'question':
      return { payload: questionPayload(message.question), contentType: QUESTION_CONTENT_TYPE };
    case 'step':
      return { payload: stepPayload(message.step), contentType: STEP_CONTENT_TYPE };
    case 'withdrawal':
      return withdrawalOf(message.target);
  }
}

function questionPayload({ id, title, context, options, pick }: Question): string {
  return JSON.stringify({
    id,
    title,
    context,
    options: options.map(({ key, label, detail }) => ({ key, label, detail })),
    pick: { option: pick.option, why: pick.why },
  });
}

function stepPayload({ id, title, why, link }: Step): string {
  return JSON.stringify(link === undefined ? { id, title, why } : { id, title, why, link });
}

function withdrawalOf(target: WithdrawalTarget): { payload: string; contentType: string } {
  switch (target.kind) {
    case 'question':
      return { payload: JSON.stringify({ questionId: target.questionId }), contentType: WITHDRAWAL_CONTENT_TYPE };
    case 'step':
      return { payload: JSON.stringify({ stepId: target.stepId }), contentType: STEP_WITHDRAWAL_CONTENT_TYPE };
  }
}
