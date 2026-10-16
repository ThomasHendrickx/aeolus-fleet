import type { DeliveryId, NeedsAttentionDelivery, OverdueDelivery } from '@aeolus-fleet/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSquadrons } from './squadrons-api';
import { silentMembers } from './squadrons-view';
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

/** Needs attention: every undeliverable or not handled delivery of the fleet, oldest first. */
export function useNeedsAttention() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.needsAttention.queryOptions());
}

/** Needs attention: the pending deliveries to a type no active ship can take, oldest sent first (decision 0041). */
export function useNoShipCanTake() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.noShipCanTake.queryOptions());
}

/** Needs attention: the overdue deliveries argo was told of by the 10 and 60 minute clocks, oldest told first (decision 0040). */
export function useOverdue() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.overdue.queryOptions());
}

const STATE_WORDS: Record<OverdueDelivery['state'], string> = { pending: 'Pending', received: 'Received', handed: 'Handed' };
const CLOCK_WORDS: Record<OverdueDelivery['clock'], string> = { notConfirmed: 'not confirmed', idle: 'session idle', busy: 'session busy' };

/** Which clock ran out, in the state it was told in: "Handed, not confirmed", "Pending, session busy". */
export function overdueReason(delivery: Pick<OverdueDelivery, 'state' | 'clock'>): string {
  return `${STATE_WORDS[delivery.state]}, ${CLOCK_WORDS[delivery.clock]}`;
}

/** Where an overdue delivery's message opens: on the page of the ship it is overdue on, in the Messages tab. */
export function overduePathOf(delivery: Pick<OverdueDelivery, 'ship' | 'message'>): string {
  return `/ships/${delivery.ship.id}?tab=messages&message=${delivery.message.id}`;
}

/**
 * How many things need attention, for the navigation: the undeliverable
 * and not handled deliveries, the overdue ones, the deliveries no ship can
 * take and, with squadrons on, the silent members. Undefined until the
 * deliveries are known.
 */
export function useAttentionCount(): number | undefined {
  const deliveries = useNeedsAttention().data?.length;
  const overdue = useOverdue().data?.length;
  const noShipCanTake = useNoShipCanTake().data?.length;
  const squadrons = useSquadrons();
  return deliveries === undefined || overdue === undefined || noShipCanTake === undefined
    ? undefined
    : deliveries + overdue + noShipCanTake + silentMembers(squadrons.data ?? []).length;
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

/**
 * Where an undeliverable delivery's message opens: on its sender's page, in
 * the Messages tab, where its delivery history shows. A message to a type
 * has no one ship to show it on, so the sender's page is the one place.
 */
export function messagePathOf(delivery: Pick<NeedsAttentionDelivery, 'message'>): string {
  const { message } = delivery;
  return `/ships/${message.sender.id}?tab=messages&message=${message.id}`;
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
