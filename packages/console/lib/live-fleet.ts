import type { EventType, FleetStreamItem, HarbourOutput, ListedShip, ShipId, ShipOutsideReadReach } from '@aeolus-fleet/common';
import type { AppRouter } from '@aeolus-fleet/core';
import { useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useSubscription, type TRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { useState } from 'react';

import type { LiveState } from '../components/molecules/live-status';
import { INBOX_KEY } from './inbox';
import { useIsReopening } from './live-updates';
import { useTRPC } from './trpc';

/**
 * The events that change what a ship's row shows: a ship, its crew,
 * its secret, its starting prompt, its crew's report, its crew request, the labels it carries, its open alerts, or how its last ping stands. An ack can
 * answer a ping and an undeliverable ping shows none, so those two reload it;
 * other message events leave the rows as they are.
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
  'AlertRaised',
  'AlertCleared',
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

/** A ship as `fleet.list` lists it: whole, or by name, type and status outside the session's read reach. */
type ShipRow = ListedShip | ShipOutsideReadReach;

/**
 * Reads ships' rows after live events, at most one read of a ship's row at a
 * time, as createLiveReloads does for a query: an event during a read asks
 * for one more read once it ends. A row that cannot be read is left as it
 * is; the pages read again by themselves (LAST_SEEN_REFRESH_MS).
 */
export function createShipRowReloads<Row = ShipRow>(input: { readRow: (shipId: ShipId) => Promise<Row>; writeRow: (row: Row) => void }): (shipId: ShipId) => void {
  const reading = new Set<ShipId>();
  const readAgain = new Set<ShipId>();

  const readUntilCurrent = async (shipId: ShipId) => {
    reading.add(shipId);
    try {
      do {
        readAgain.delete(shipId);
        input.writeRow(await input.readRow(shipId));
      } while (readAgain.has(shipId));
    } catch {
      // Left as it is: the pages' own refresh brings the row.
    } finally {
      reading.delete(shipId);
      readAgain.delete(shipId);
    }
  };

  return (shipId) => {
    if (reading.has(shipId)) {
      readAgain.add(shipId);
    } else {
      void readUntilCurrent(shipId);
    }
  };
}

/** The rows with a ship's row as read alone in its place. */
function withShipInPlace(ships: readonly ShipRow[], row: ShipRow): ShipRow[] {
  return ships.map((ship) => (ship.id === row.id ? row : ship));
}

/** A page of ships as `fleet.list` answers it. */
interface ShipPage {
  items: ShipRow[];
  nextCursor: string | null;
}

function isOnPages(pages: InfiniteData<ShipPage>, shipId: ShipId): boolean {
  return pages.pages.some((page) => page.items.some((ship) => ship.id === shipId));
}

/**
 * A view's loaded pages with a ship's row as read alone: in its place, or
 * first in the first page when no loaded page shows it, until the pages'
 * refresh puts it in its place or drops it (Thomas's rule, #1173). The view
 * shows the row only while it matches the view's filter (lib/ship-rows.ts).
 */
export function withListedShipOnPages(pages: InfiniteData<ShipPage>, row: ShipRow): InfiniteData<ShipPage> {
  if (isOnPages(pages, row.id)) {
    return { ...pages, pages: pages.pages.map((page) => ({ ...page, items: withShipInPlace(page.items, row) })) };
  }
  const [first, ...rest] = pages.pages;
  return first === undefined ? pages : { ...pages, pages: [{ ...first, items: [row, ...first.items] }, ...rest] };
}

/** A page of Harbour's tiles as `fleet.harbour` answers it. */
type HarbourPage = HarbourOutput;
type HarbourTile = HarbourOutput['items'][number];

/**
 * Harbour's loaded pages with a ship's tile as read alone: in its place, or
 * first on the first page when no page shows it; taken off every page when
 * Harbour no longer shows the ship (retired, or out of read reach).
 */
export function withHarbourTile(pages: InfiniteData<HarbourPage>, read: { shipId: ShipId; tile: HarbourTile | undefined }): InfiniteData<HarbourPage> {
  const { shipId, tile } = read;
  if (tile === undefined) {
    return { ...pages, pages: pages.pages.map((page) => ({ ...page, items: page.items.filter((each) => each.id !== shipId) })) };
  }
  if (pages.pages.some((page) => page.items.some((each) => each.id === shipId))) {
    return { ...pages, pages: pages.pages.map((page) => ({ ...page, items: page.items.map((each) => (each.id === shipId ? tile : each)) })) };
  }
  const [first, ...rest] = pages.pages;
  return first === undefined ? pages : { ...pages, pages: [{ ...first, items: [tile, ...first.items] }, ...rest] };
}

/** Harbour's loaded pages with the numbers read again on the first page. */
function withHarbourCounts(pages: InfiniteData<HarbourPage>, counts: HarbourPage['counts']): InfiniteData<HarbourPage> {
  const [first, ...rest] = pages.pages;
  return first === undefined ? pages : { ...pages, pages: [{ ...first, counts }, ...rest] };
}

/** Reads something again after live events, at most one read at a time, and once more after it for the events that came meanwhile. */
function createSingleReload(readAndWrite: () => Promise<void>): () => void {
  // As createShipRowReloads keeps them, for the one thing it reads.
  const reading = new Set<'read'>();
  const readAgain = new Set<'read'>();
  const readUntilCurrent = async () => {
    reading.add('read');
    try {
      do {
        readAgain.delete('read');
        await readAndWrite();
      } while (readAgain.has('read'));
    } catch {
      // Left as they are: a resync reads them again.
    } finally {
      reading.delete('read');
      readAgain.delete('read');
    }
  };
  return () => {
    if (reading.has('read')) {
      readAgain.add('read');
    } else {
      void readUntilCurrent();
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

/** The events that change a fleet's sealing (decision 0068): its state, its keys, or whether its company key is reachable. */
const SEALING_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  'FleetSealingTurnedOn',
  'FleetPayloadsSealed',
  'FleetDataKeyCreated',
  'FleetCompanyKeyChanged',
  'FleetRecoveryKeyChanged',
  'FleetKeysRecovered',
  'FleetKeyUnavailable',
  'FleetKeyAvailable',
]);

export function isSealingChange(type: EventType): boolean {
  return SEALING_EVENTS.has(type);
}

/** The events that change which features the fleet's console shows (decision 0069): console.session answers its flags. */
const FEATURE_FLAG_EVENTS: ReadonlySet<EventType> = new Set<EventType>(['FeatureFlagTurnedOn', 'FeatureFlagTurnedOff']);

export function isFeatureFlagChange(type: EventType): boolean {
  return FEATURE_FLAG_EVENTS.has(type);
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
  /** Ships a live event put first on the overview's loaded pages since the page opened: their rows get the highlight. */
  placedFirstShipIds: ReadonlySet<ShipId>;
  /** Why the subscription ended, when it was refused: the page sends the operator to sign in. */
  error: unknown;
}

/**
 * What each item of the fleet's live stream reloads (docs/architecture.md,
 * "Live updates"), only the resources the event concerns (performance
 * design, decision 3): an event reloads the page of each ship that caused it
 * or that it names; a ship's event those ships' rows on the overview's
 * loaded pages, each read alone (a ship not on them
 * goes first, highlighted), the ship counts and the stuck deliveries (their count, summary
 * and places); a message's event the open
 * message, the ships' message lists and argo's inbox, whose delivery states
 * it changes, and the stuck deliveries; an acknowledgement the acknowledged
 * in 24 hours; a delivery
 * that becomes undeliverable or not handled, or is dismissed, Needs
 * attention; a label's event the fleet's labels; a sealing event the fleet's sealing; NetworkRulesDeclared the
 * declared network rules; and a change of the rules or the draft the network
 * rules, what the draft changes and the reach. `resync`, sent first and
 * whenever the browser fell too far behind, reloads every one of them.
 */
export function createLiveFleetHandler(input: {
  trpc: TRPCOptionsProxy<AppRouter>;
  queryClient: QueryClient;
  reload: (queryKey: readonly unknown[]) => void;
  /** A ship's row went first on the overview's loaded pages, which shows none of it. */
  onPlacedFirst: (shipId: ShipId) => void;
}): (item: FleetStreamItem) => void {
  const { trpc, queryClient, reload } = input;
  // Every view's pages the overview loaded (features/fleet/hooks/fleet-pages.ts).
  const pagesKey: readonly unknown[] = [...trpc.fleet.list.infiniteQueryKey()];
  const loadedPages = () => queryClient.getQueriesData<InfiniteData<ShipPage>>({ queryKey: pagesKey }).flatMap(([, pages]) => (pages === undefined ? [] : [pages]));
  const reloadRow = createShipRowReloads({
    readRow: (shipId) => queryClient.query({ ...trpc.fleet.listedShip.queryOptions({ shipId }), staleTime: 0 }),
    writeRow: (row) => {
      const isPlacedFirst = loadedPages().some((pages) => !isOnPages(pages, row.id));
      queryClient.setQueriesData<InfiniteData<ShipPage>>({ queryKey: pagesKey }, (pages) => pages && withListedShipOnPages(pages, row));
      if (isPlacedFirst) {
        input.onPlacedFirst(row.id);
      }
    },
  });
  // Harbour's pages (features/fleet/hooks/harbour.ts): a ship's tile read alone, and the numbers, never the fleet again.
  const harbourKey: readonly unknown[] = [...trpc.fleet.harbour.infiniteQueryKey()];
  const isHarbourLoaded = () => queryClient.getQueriesData<InfiniteData<HarbourPage>>({ queryKey: harbourKey }).some(([, pages]) => pages !== undefined);
  const reloadTile = createShipRowReloads<{ shipId: ShipId; tile: HarbourTile | undefined }>({
    readRow: async (shipId) => {
      const read = await queryClient.query({ ...trpc.fleet.harbour.queryOptions({ shipIds: [shipId] }), staleTime: 0 });
      return { shipId, tile: read.items[0] };
    },
    writeRow: (read) => {
      queryClient.setQueriesData<InfiniteData<HarbourPage>>({ queryKey: harbourKey }, (pages) => pages && withHarbourTile(pages, read));
    },
  });
  const reloadHarbourCounts = createSingleReload(async () => {
    const { counts } = await queryClient.query({ ...trpc.fleet.harbour.queryOptions({ limit: 1 }), staleTime: 0 });
    queryClient.setQueriesData<InfiniteData<HarbourPage>>({ queryKey: harbourKey }, (pages) => pages && withHarbourCounts(pages, counts));
  });
  const reloadStuck = () => {
    reload(trpc.fleet.stuckCount.queryKey());
    reload(trpc.fleet.stuckSummary.queryKey());
    // Every cause's pages of places, whichever are shown.
    reload(trpc.fleet.stuck.pathKey());
  };
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
      reload(trpc.fleet.messageDeliveries.infiniteQueryKey({ messageId: event.messageId }));
      reload(trpc.fleet.inbox.pathKey());
      reload(trpc.fleet.inboxCount.queryKey());
      reload(INBOX_KEY);
      // A delivery that moves, or a new one, changes what is stuck.
      reloadStuck();
    }
    if (event.type === 'DeliveryAcknowledged') {
      reload(trpc.fleet.acknowledged.queryKey());
    }
    if (isAttentionChange(event.type)) {
      reload(trpc.fleet.needsAttention.pathKey());
    }
    if (isLabelChange(event.type)) {
      reload(trpc.fleet.labels.queryKey());
    }
    if (isSealingChange(event.type)) {
      reload(trpc.fleet.sealing.queryKey());
    }
    if (isFeatureFlagChange(event.type)) {
      reload(trpc.console.session.queryKey());
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
    // Only a page that shows the overview's pages needs the rows.
    if (loadedPages().length > 0) {
      for (const concerned of new Set([event.shipId, event.actorShipId])) {
        if (concerned !== null) {
          reloadRow(concerned);
        }
      }
    }
    if (isHarbourLoaded()) {
      for (const concerned of new Set([event.shipId, event.actorShipId])) {
        if (concerned !== null) {
          reloadTile(concerned);
        }
      }
      reloadHarbourCounts();
    }
    // A commission, a crew, a release or a crew request moves the ship counts: the fleet's and each view's.
    reload(trpc.fleet.shipCounts.pathKey());
    // A commission, a crew or a release changes why a delivery waits.
    reloadStuck();
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
  const [placedFirstShipIds, setPlacedFirstShipIds] = useState<ReadonlySet<ShipId>>(new Set());
  const isReopening = useIsReopening();

  const [onItem] = useState(() =>
    createLiveFleetHandler({
      trpc,
      queryClient,
      reload: createLiveReloads(queryClient),
      onPlacedFirst: (shipId) => {
        setPlacedFirstShipIds((shown) => new Set([...shown, shipId]));
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
  return { live, placedFirstShipIds, error: subscription.error };
}
