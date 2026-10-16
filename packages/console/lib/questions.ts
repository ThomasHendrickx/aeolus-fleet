import type { DeliveryId, InboxMessage, InboxQuestion } from '@aeolus-fleet/common';

/**
 * Questions to argo (decision 0038) as the web app's server reads them from
 * argo's inbox (lib/question-answer.ts): each with its answer, why it is
 * stale and the question a replacement replaces. The inbox shows them on top
 * (#849); answers go through a server function (lib/questions-actions.ts).
 */

/**
 * Why a question is stale, so it can no longer be answered: its asker
 * withdrew it, or replaced it with the question the replacement's delivery
 * carries. The delivery is the withdrawal's or replacement's message.
 */
export type Staleness =
  | { kind: 'withdrawn'; deliveryId: DeliveryId; sentAt: string }
  | { kind: 'replaced'; deliveryId: DeliveryId; sentAt: string; by: { title: string } };

/**
 * A message to argo that asks a question, with its answer or none, why it is
 * stale or null, and for a replacement the question it replaces.
 */
export type QuestionMessage = Omit<InboxMessage, 'replies'> & {
  question: InboxQuestion;
  stale: Staleness | null;
  replaces: { deliveryId: DeliveryId; title: string } | null;
};

/** The deliveries that carry questions, and the withdrawals that made one stale: the inbox shows no message for them. */
export function questionDeliveryIdsOf(questions: readonly { deliveryId: DeliveryId; stale: { kind: Staleness['kind']; deliveryId: DeliveryId } | null }[]): ReadonlySet<DeliveryId> {
  return new Set(questions.flatMap(({ deliveryId, stale }) => (stale?.kind === 'withdrawn' ? [deliveryId, stale.deliveryId] : [deliveryId])));
}
