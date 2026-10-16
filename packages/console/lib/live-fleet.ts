import type { EventType, ShipId } from '@aeolus-fleet/common';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useState } from 'react';

import type { LiveState } from '../components/molecules/live-status';
import { INBOX_KEY } from './inbox';
import { useTRPC } from './trpc';

/**
 * The events that change what the fleet snapshot shows: a ship, its crew,
 * its secret, its starting prompt, its crew's report, its crew request, the labels it carries, or how its last ping stands. An ack can
 * answer a ping and an undeliverable ping shows none, so those two reload it;
 * other message events leave the snapshot as it is.
 */
const SHIP_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  'FleetInitialised',
  'ShipCommissioned',
  'ShipClaimed',
  'LeaseRevoked',
  'CredentialRevoked',
  'StartingPromptIssued',
  'ShipRetired',
  'DeliveryAcknowledged',
  'DeliveryUndeliverable',
  'ShipReported',
  'CrewRequested',
  'CrewRequestRemoved',
  'CrewAssigned',
  'CrewStatusChanged',
  'CrewRequestExplained',
  'CrewRequestGivenBack',
  'LabelAssigned',
  'LabelUnassigned',
  'LabelRetired',
]);

/**
 * Reloads the queries under a key after a live event, so each shows what the
 * event changed. An invalidation alone joins a first read still in flight,
 * which may have read before the change, and keeps its answer for good
 * (TanStack Query reuses a running fetch while a query has no data yet). So a
 * read in flight without data is cancelled first, and every query under the
 * key reads again after the event.
 */
export async function reloadQueries(queryClient: QueryClient, queryKey: readonly unknown[]): Promise<void> {
  await queryClient.cancelQueries({
    queryKey,
    predicate: (query) => query.state.data === undefined && query.state.fetchStatus === 'fetching',
  });
  await queryClient.invalidateQueries({ queryKey });
}

export function isShipChange(type: EventType): boolean {
  return SHIP_EVENTS.has(type);
}

/** The events that change the fleet's labels: their definitions, their values, or who carries them (the filter counts ships). */
const LABEL_EVENTS: ReadonlySet<EventType> = new Set<EventType>(['LabelDefined', 'LabelValuesChanged', 'LabelRetired', 'LabelAssigned', 'LabelUnassigned', 'LabelDeleted']);

export function isLabelChange(type: EventType): boolean {
  return LABEL_EVENTS.has(type);
}

/** The events that change Needs attention: a delivery becomes undeliverable or not handled, or the operator lets one go. */
const ATTENTION_EVENTS: ReadonlySet<EventType> = new Set<EventType>(['DeliveryUndeliverable', 'DeliveryNotHandled', 'DeliveryDismissed']);

export function isAttentionChange(type: EventType): boolean {
  return ATTENTION_EVENTS.has(type);
}

/** A ship declaring its network rules, or withdrawing them, changes the declared rules Network shows (decision 0037). */
export function isDeclaredRulesChange(type: EventType): boolean {
  return type === 'NetworkRulesDeclared';
}

/** The subscription's state as the live dot words it. */
export function liveStateOf(status: 'idle' | 'connecting' | 'pending' | 'error'): LiveState {
  switch (status) {
    case 'pending':
      return 'live';
    case 'connecting':
      return 'reconnecting';
    case 'idle':
    case 'error':
      return 'offline';
  }
}

export interface LiveFleet {
  live: LiveState;
  /** Ships commissioned since the page opened: their rows get the highlight. */
  newShipIds: ReadonlySet<ShipId>;
  /** Why the subscription ended, when it was refused: the page sends the operator to sign in. */
  error: unknown;
}

/**
 * Follows the fleet live over the WebSocket (docs/architecture.md, "Live
 * updates"). Each committed event that changes a ship reloads the snapshot;
 * an event reloads the page of each ship that caused it or that it names, and
 * a message's event reloads the open message, the ships' message lists and
 * argo's inbox, whose delivery states it changes; a delivery that becomes undeliverable or
 * not handled, or is dismissed, reloads Needs attention, a message's or a ship's event the fleet's health, a label's event the fleet's labels, and NetworkRulesDeclared the declared network rules. `resync`, sent first and whenever the
 * browser fell too far behind, reloads every one of them. The tRPC client sends the number of the last event back when it
 * reconnects, so the server replays whatever committed meanwhile.
 */
export function useLiveFleet(): LiveFleet {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [newShipIds, setNewShipIds] = useState<ReadonlySet<ShipId>>(new Set());

  const reload = (queryKey: readonly unknown[]) => {
    void reloadQueries(queryClient, queryKey);
  };
  const reloadSnapshot = () => {
    reload(trpc.fleet.list.queryKey());
  };

  const subscription = useSubscription(
    trpc.fleet.events.subscriptionOptions(
      { lastEventId: null },
      {
        onData: ({ data: item }) => {
          if (item.kind === 'resync') {
            reload(trpc.fleet.pathKey());
            reload(INBOX_KEY);
            return;
          }
          const { event } = item;
          for (const concerned of new Set([event.shipId, event.actorShipId])) {
            if (concerned !== null) {
              reload(trpc.fleet.ship.queryKey({ shipId: concerned }));
              reload(trpc.fleet.shipTimeline.queryKey({ shipId: concerned }));
              // A turn report, a push receive or a lease end changes its side of the way.
              reload(trpc.fleet.shipWay.queryKey({ shipId: concerned }));
            }
          }
          if (event.messageId !== null) {
            reload(trpc.fleet.shipMessages.pathKey());
            // A delivery to a type waits for every ship of the type; an overdue one clears as its delivery moves on.
            reload(trpc.fleet.shipWay.pathKey());
            reload(trpc.fleet.overdue.queryKey());
            reload(trpc.fleet.message.queryKey({ messageId: event.messageId }));
            reload(trpc.fleet.inbox.pathKey());
            reload(INBOX_KEY);
            // A send to a type, or a ship taking one, changes what no ship can take.
            reload(trpc.fleet.noShipCanTake.queryKey());
            // A delivery that moves, or a new one, changes what is stuck.
            reload(trpc.fleet.health.queryKey());
          }
          if (isAttentionChange(event.type)) {
            reload(trpc.fleet.needsAttention.queryKey());
          }
          if (isLabelChange(event.type)) {
            reload(trpc.fleet.labels.queryKey());
          }
          if (isDeclaredRulesChange(event.type)) {
            reload(trpc.fleet.declaredNetworkRules.queryKey());
          }
          if (!isShipChange(event.type)) {
            return;
          }
          reloadSnapshot();
          // A commission or a retire changes which types an active ship has.
          reload(trpc.fleet.noShipCanTake.queryKey());
          // A commission, a crew or a release changes why a delivery waits.
          reload(trpc.fleet.health.queryKey());
          const { shipId } = event;
          if (event.type === 'ShipCommissioned' && shipId !== null) {
            setNewShipIds((shown) => new Set([...shown, shipId]));
          }
        },
      },
    ),
  );

  return { live: liveStateOf(subscription.status), newShipIds, error: subscription.error };
}
