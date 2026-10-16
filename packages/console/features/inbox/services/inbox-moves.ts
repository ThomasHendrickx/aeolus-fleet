import type { DeliveryId } from '@aeolus-fleet/common';

/**
 * Moving through argo's inbox (#849): J and K step through the rows, the
 * question page counts the open questions and offers the next one, and the
 * Answer button names what it sends.
 */

/** "Answer: 14 days", "Answer: 30 days, with note" or "Send note"; undefined while there is nothing to send. */
export function answerLabelOf({ option, hasNote }: { option: string | undefined; hasNote: boolean }): string | undefined {
  if (option === undefined) {
    return hasNote ? 'Send note' : undefined;
  }
  return hasNote ? `Answer: ${option}, with note` : `Answer: ${option}`;
}

/** The row before or after the open one, staying at either end; the first row when none is open. */
export function neighbourOf(order: readonly DeliveryId[], { current, direction }: { current: DeliveryId | undefined; direction: 'next' | 'previous' }): DeliveryId | undefined {
  const at = current === undefined ? -1 : order.indexOf(current);
  if (at === -1) {
    return order[0];
  }
  const step = direction === 'next' ? 1 : -1;
  return order[Math.min(Math.max(at + step, 0), order.length - 1)];
}

export interface QuestionPosition {
  /** Its number among the open questions, from 1; undefined once it is no longer open. */
  number: number | undefined;
  count: number;
  /** The open question to go on to: the one after it, or the first; undefined when no other is open. */
  next: DeliveryId | undefined;
  /** How many other questions are open. */
  left: number;
}

export function questionPositionOf(openQuestions: readonly DeliveryId[], current: DeliveryId): QuestionPosition {
  const at = openQuestions.indexOf(current);
  const others = openQuestions.filter((id) => id !== current);
  const after = at === -1 ? undefined : openQuestions[at + 1];
  return { number: at === -1 ? undefined : at + 1, count: openQuestions.length, next: after ?? others[0], left: others.length };
}
