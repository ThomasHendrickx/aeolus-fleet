import type { DeliveryId, NeedsAttentionDelivery, ShipId } from '@aeolus-fleet/common';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { CONSOLE_PAGE_SIZE, nextCursorOf, pagedListOf } from './paged-list';
import { useTRPC } from './trpc';

/**
 * Whether Needs attention offers Resend: never for a ping, which pings never
 * stack. It offers only Dismiss, and a fresh ping goes through Ping.
 */
export function canResend(delivery: NeedsAttentionDelivery): boolean {
  return !delivery.message.isPing;
}

/**
 * Why a delivery is undeliverable, from its attempts: on a pull ship each
 * receive hands it over once, and the fifth receive is refused instead; on a
 * pushed ship its computer side hands it to the agent, and the fifth
 * hand-over is refused (decision 0040).
 */
export function undeliverableReason(delivery: Pick<NeedsAttentionDelivery, 'attempts' | 'isPushed'>): string {
  const times = String(delivery.attempts - 1);
  return delivery.isPushed
    ? `Handed ${times} times, never confirmed; fifth refused: undeliverable.`
    : `Handed (pulled) ${times} times, never acknowledged; fifth receive refused: undeliverable.`;
}

const NOT_HANDLED_REASON = 'Acknowledged, then its turn died; handed once more, and that turn died too: not handled.';

/**
 * Why a delivery is in Needs attention: undeliverable after its attempts, or
 * not handled, when the turn it was handed once more to died too, with the
 * reason its crew gave, when it gave one (#847).
 */
export function attentionReason(delivery: Pick<NeedsAttentionDelivery, 'state' | 'attempts' | 'isPushed' | 'reason'>): string {
  switch (delivery.state) {
    case 'undeliverable':
      return undeliverableReason(delivery);
    case 'notHandled':
      return delivery.reason === null ? NOT_HANDLED_REASON : `${NOT_HANDLED_REASON} Its crew said: ${delivery.reason}.`;
  }
}

/** Needs attention: the undeliverable or not handled deliveries of the fleet, or of one ship for its page, in either state or one, oldest first, a page at a time. */
export function useNeedsAttention(of: { shipId?: ShipId; state?: NeedsAttentionDelivery['state'] } = {}) {
  const trpc = useTRPC();
  return pagedListOf(useInfiniteQuery(trpc.fleet.needsAttention.infiniteQueryOptions({ ...of, limit: CONSOLE_PAGE_SIZE }, { getNextPageParam: nextCursorOf })));
}

/** Refreshes Needs attention, and every ship page read, after a resend or a dismiss. */
function useRefreshFleet(): () => Promise<void> {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() });
}

/** Resends an undeliverable or not handled delivery: a new message from its sender that names it. Its data holds the new message. */
export function useResendDelivery() {
  const trpc = useTRPC();
  const refresh = useRefreshFleet();
  return useMutation(trpc.fleet.resend.mutationOptions({ onSuccess: refresh }));
}

/** Dismisses an undeliverable or not handled delivery: it stays in history, dismissed. */
export function useDismissDelivery() {
  const trpc = useTRPC();
  const refresh = useRefreshFleet();
  return useMutation(trpc.fleet.dismiss.mutationOptions({ onSuccess: refresh }));
}

/** Who a message went to, in words: the ship's name, or any ship of its type. */
function recipientWords(delivery: Pick<NeedsAttentionDelivery, 'message'>): string {
  const { recipient } = delivery.message;
  return recipient.kind === 'ship' ? recipient.ship.name : `any ship of type ${recipient.type}`;
}

/** The toast after a resend: what happened, as facts. */
export function resentToast(delivery: Pick<NeedsAttentionDelivery, 'message'>): { title: string; description: string } {
  return {
    title: 'Message resent',
    description: `A new message went to ${recipientWords(delivery)}. The original is dismissed.`,
  };
}

/** The toast after a dismiss. */
export const DISMISSED_TOAST = {
  title: 'Delivery dismissed',
  description: 'It stays in the timelines as dismissed.',
} as const;

/** The delivery the list shows with this id, if it still does. */
export function deliveryWithId(
  deliveries: readonly NeedsAttentionDelivery[] | undefined,
  deliveryId: DeliveryId,
): NeedsAttentionDelivery | undefined {
  return deliveries?.find((delivery) => delivery.deliveryId === deliveryId);
}
