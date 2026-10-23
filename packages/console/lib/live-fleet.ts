import type { EventType, FleetStreamItem, ShipId } from '@aeolus-fleet/common';
import type { AppRouter } from '@aeolus-fleet/core';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSubscription, type TRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { useState } from 'react';

import type { LiveState } from '../components/molecules/live-status';
import { INBOX_KEY } from './inbox';
import { useIsReopening } from './live-updates';
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
 * Reloads the queries under a key after live events, at most one read of a
 * query at a time (#1027). Cancelling a read and starting another for each
 * event, as an invalidation does, leaves the server working on every read
 * the browser let go: on a busy fleet the reads of the snapshot then pile up
 * in the server's pool. Here an event during a read asks for one more read
 * once that read ends, however many events came meanwhile. A read that began
 * before the event, which may have read before the change, is joined and
 * then read once more.
 */
export function createLiveReloads(queryClient: QueryClient): (queryKey: readonly unknown[]) => void {
  const reading = new Set<string>();
  const readAgain = new Set<string>();

  const read = (queryKey: readonly unknown[]) => queryClient.invalidateQueries({ queryKey, exact: true }, { cancelRefetch: false });

  const readUntilCurrent = async (query: { queryHash: string; queryKey: readonly unknown[]; isBehind: boolean }) => {
    reading.add(query.queryHash);
    let isBehind = query.isBehind;
    try {
      await read(query.queryKey);
      while (isBehind || readAgain.delete(query.queryHash)) {
        isBehind = false;
        await read(query.queryKey);
      }
    } finally {
      reading.delete(query.queryHash);
    }
  };

  return (queryKey) => {
    for (const query of queryClient.getQueryCache().findAll({ queryKey })) {
      if (reading.has(query.queryHash)) {
        readAgain.add(query.queryHash);
      } else {
        void readUntilCurrent({ queryHash: query.queryHash, queryKey: query.queryKey, isBehind: query.state.fetchStatus === 'fetching' });
      }
    }
  };
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

/** A built-in rule turned on or off, or rules applied, which turn open off or on, changes the built-in rules Network shows (decision 0034). */
export function isBuiltInRulesChange(type: EventType): boolean {
  return type === 'BuiltInRuleChanged' || type === 'NetworkRulesSet';
}

/** The events that move the network settings or the draft (decision 0035): each changes the rules Network shows, what the draft changes and the reach it explains. */
const NETWORK_RULES_EVENTS: ReadonlySet<EventType> = new Set<EventType>(['NetworkRulesSet', 'NetworkRulesDraftSaved', 'NetworkRulesDraftDiscarded', 'NetworkRulesDeclared', 'BuiltInRuleChanged']);

export function isNetworkRulesChange(type: EventType): boolean {
  return NETWORK_RULES_EVENTS.has(type);
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
 * What each item of the fleet's live stream reloads (docs/architecture.md,
 * "Live updates"): an event reloads the page of each ship that caused it or
 * that it names; a ship's event the fleet snapshot and the fleet's health; a
 * message's event the open message, the ships' message lists and argo's
 * inbox, whose delivery states it changes, and the fleet's health; a delivery
 * that becomes undeliverable or not handled, or is dismissed, Needs
 * attention; a label's event the fleet's labels; NetworkRulesDeclared the
 * declared network rules; and a change of the rules or the draft the network
 * rules, what the draft changes and the reach. `resync`, sent first and
 * whenever the browser fell too far behind, reloads every one of them.
 */
export function createLiveFleetHandler(input: {
  trpc: TRPCOptionsProxy<AppRouter>;
  reload: (queryKey: readonly unknown[]) => void;
  onCommissioned: (shipId: ShipId) => void;
}): (item: FleetStreamItem) => void {
  const { trpc, reload } = input;
  return (item) => {
    if (item.kind === 'resync') {
      reload(trpc.fleet.pathKey());
      reload(INBOX_KEY);
      return;
    }
    const { event } = item;
    for (const concerned of new Set([event.shipId, event.actorShipId])) {
      if (concerned !== null) {
        reload(trpc.fleet.ship.queryKey({ shipId: concerned }));
        reload(trpc.fleet.shipTimeline.infiniteQueryKey({ shipId: concerned }));
        // A turn report, a push receive or a lease end changes its side of the way.
        reload(trpc.fleet.shipWay.queryKey({ shipId: concerned }));
      }
    }
    if (event.messageId !== null) {
      reload(trpc.fleet.shipMessages.pathKey());
      // A delivery to a type waits for every ship of the type; an overdue one clears as its delivery moves on.
      reload(trpc.fleet.shipWay.pathKey());
      reload(trpc.fleet.message.queryKey({ messageId: event.messageId }));
      reload(trpc.fleet.inbox.pathKey());
      reload(trpc.fleet.inboxCount.queryKey());
      reload(INBOX_KEY);
      // A delivery that moves, or a new one, changes what is stuck.
      reload(trpc.fleet.health.queryKey());
    }
    if (isAttentionChange(event.type)) {
      reload(trpc.fleet.needsAttention.pathKey());
    }
    if (isLabelChange(event.type)) {
      reload(trpc.fleet.labels.queryKey());
    }
    if (isDeclaredRulesChange(event.type)) {
      reload(trpc.fleet.declaredNetworkRules.queryKey());
    }
    if (isBuiltInRulesChange(event.type)) {
      reload(trpc.fleet.builtInRules.queryKey());
    }
    if (isNetworkRulesChange(event.type)) {
      reload(trpc.fleet.networkRules.queryKey());
      reload(trpc.fleet.networkRulesDraftChanges.queryKey());
      reload(trpc.fleet.explainReach.pathKey());
    }
    if (!isShipChange(event.type)) {
      return;
    }
    // The snapshot, every page the overview loaded for its view, and their counts.
    reload(trpc.fleet.list.pathKey());
    reload(trpc.fleet.shipCounts.pathKey());
    // A commission, a crew or a release changes why a delivery waits.
    reload(trpc.fleet.health.queryKey());
    const { shipId } = event;
    if (event.type === 'ShipCommissioned' && shipId !== null) {
      input.onCommissioned(shipId);
    }
  };
}

/**
 * Follows the fleet live over the WebSocket, reloading what each item
 * concerns (createLiveFleetHandler). The tRPC client sends the number of the
 * last event back when it reconnects, so the server replays whatever
 * committed meanwhile.
 */
export function useLiveFleet(): LiveFleet {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [newShipIds, setNewShipIds] = useState<ReadonlySet<ShipId>>(new Set());
  const isReopening = useIsReopening();

  const [onItem] = useState(() =>
    createLiveFleetHandler({
      trpc,
      reload: createLiveReloads(queryClient),
      onCommissioned: (shipId) => {
        setNewShipIds((shown) => new Set([...shown, shipId]));
      },
    }),
  );

  const subscription = useSubscription(
    trpc.fleet.events.subscriptionOptions(
      { lastEventId: null },
      {
        onData: ({ data: item }) => {
          onItem(item);
        },
      },
    ),
  );

  // Reopening after a renewal, the server replays what commits meanwhile: still Live (accounts design, A4).
  const live = subscription.status === 'connecting' && isReopening ? 'live' : liveStateOf(subscription.status);
  return { live, newShipIds, error: subscription.error };
}
