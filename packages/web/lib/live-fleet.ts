import type { EventType, ShipId } from '@aeolus-fleet/common';
import { useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useState } from 'react';

import type { LiveState } from '../components/molecules/live-status';
import { useTRPC } from './trpc';

/**
 * The events that change what the fleet snapshot shows: a ship, its crew,
 * its secret or its starting prompt. Message events leave the snapshot as it
 * is, so they do not reload it.
 */
const SHIP_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  'FleetInitialised',
  'ShipCommissioned',
  'ShipClaimed',
  'LeaseRevoked',
  'CredentialRevoked',
  'StartingPromptIssued',
  'ShipRetired',
]);

export function isShipChange(type: EventType): boolean {
  return SHIP_EVENTS.has(type);
}

/** The events that change Needs attention: a delivery becomes undeliverable, or the operator lets one go. */
const ATTENTION_EVENTS: ReadonlySet<EventType> = new Set<EventType>(['DeliveryUndeliverable', 'DeliveryDismissed']);

export function isAttentionChange(type: EventType): boolean {
  return ATTENTION_EVENTS.has(type);
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
 * is dismissed reloads Needs attention. `resync`, sent first and whenever the
 * browser fell too far behind, reloads every one of them. The tRPC client sends the number of the last event back when it
 * reconnects, so the server replays whatever committed meanwhile.
 */
export function useLiveFleet(): LiveFleet {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [newShipIds, setNewShipIds] = useState<ReadonlySet<ShipId>>(new Set());

  const reloadSnapshot = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.fleet.list.queryKey() });
  };
  const reload = (queryKey: readonly unknown[]) => {
    void queryClient.invalidateQueries({ queryKey });
  };

  const subscription = useSubscription(
    trpc.fleet.events.subscriptionOptions(
      { lastEventId: null },
      {
        onData: ({ data: item }) => {
          if (item.kind === 'resync') {
            reload(trpc.fleet.pathKey());
            return;
          }
          const { event } = item;
          for (const concerned of new Set([event.shipId, event.actorShipId])) {
            if (concerned !== null) {
              reload(trpc.fleet.ship.queryKey({ shipId: concerned }));
              reload(trpc.fleet.shipTimeline.queryKey({ shipId: concerned }));
            }
          }
          if (event.messageId !== null) {
            reload(trpc.fleet.shipMessages.pathKey());
            reload(trpc.fleet.message.queryKey({ messageId: event.messageId }));
            reload(trpc.fleet.inbox.pathKey());
          }
          if (isAttentionChange(event.type)) {
            reload(trpc.fleet.needsAttention.queryKey());
          }
          if (!isShipChange(event.type)) {
            return;
          }
          reloadSnapshot();
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
