import { createIdGenerator, EVENT_TYPES, type EventType, type ListedShip, type LiveFleetEvent, type ShipId } from '@aeolus-fleet/common';
import type { AppRouter } from '@aeolus-fleet/core';
import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { describe, expect, it } from 'vitest';

import { uniqueById } from './paged-list';
import { createLiveFleetHandler, createLiveReloads, isAttentionChange, isBuiltInRulesChange, isDeclaredRulesChange, isFeatureFlagChange, isLabelChange, isNetworkRulesChange, isSealingChange, isShipChange, liveStateOf } from './live-fleet';

describe('liveStateOf', () => {
  it.each([
    ['pending', 'live'],
    ['connecting', 'reconnecting'],
    ['idle', 'offline'],
    ['error', 'offline'],
  ] as const)('words a %s subscription as %s', (status, live) => {
    expect(liveStateOf(status)).toBe(live);
  });
});

describe('isShipChange', () => {
  it.each([
    'ShipCommissioned',
    'ShipClaimed',
    'LeaseRevoked',
    'CredentialRevoked',
    'StartingPromptIssued',
    'ShipRetired',
    'DeliveryAcknowledged',
    'DeliveryUndeliverable',
    'ShipReported',
    'LabelAssigned',
    'LabelUnassigned',
    'LabelRetired',
  ] as const)(
    "changes a ship's row for %s",
    (type) => {
      expect(isShipChange(type)).toBe(true);
    },
  );

  it.each(['MessageAccepted', 'DeliveryHanded', 'DeliveryReturned'] as const)(
    "leaves the ships' rows alone for %s",
    (type) => {
      expect(isShipChange(type)).toBe(false);
    },
  );
});

describe('isLabelChange', () => {
  it.each(['LabelDefined', 'LabelValuesChanged', 'LabelRetired', 'LabelAssigned', 'LabelUnassigned', 'LabelDeleted'] as const)('reloads the labels for %s', (type) => {
    expect(isLabelChange(type)).toBe(true);
  });

  it.each(['ShipCommissioned', 'ShipRetired', 'MessageAccepted'] as const)('leaves the labels alone for %s', (type) => {
    expect(isLabelChange(type)).toBe(false);
  });
});

describe('isFeatureFlagChange', () => {
  it.each(['FeatureFlagTurnedOn', 'FeatureFlagTurnedOff'] as const)('reloads the session, which answers the flags, for %s (decision 0069)', (type) => {
    expect(isFeatureFlagChange(type)).toBe(true);
  });

  it.each(['FleetSealingTurnedOn', 'MessageAccepted'] as const)('leaves the session alone for %s', (type) => {
    expect(isFeatureFlagChange(type)).toBe(false);
  });
});

describe('isSealingChange', () => {
  it.each(['FleetSealingTurnedOn', 'FleetPayloadsSealed', 'FleetDataKeyCreated', 'FleetCompanyKeyChanged', 'FleetRecoveryKeyChanged', 'FleetKeysRecovered', 'FleetKeyUnavailable', 'FleetKeyAvailable'] as const)('reloads the sealing page for %s', (type) => {
    expect(isSealingChange(type)).toBe(true);
  });

  it.each(['ShipCommissioned', 'MessageAccepted'] as const)('leaves the sealing alone for %s', (type) => {
    expect(isSealingChange(type)).toBe(false);
  });
});

describe('isAttentionChange', () => {
  it.each(['DeliveryUndeliverable', 'DeliveryNotHandled', 'DeliveryDismissed'] as const)('reloads Needs attention for %s', (type) => {
    expect(isAttentionChange(type)).toBe(true);
  });

  it.each([
    'MessageAccepted',
    'LeasePushed',
    'DeliveryReceived',
    'DeliveryHanded',
    'DeliveryAcknowledged',
    'DeliveryHandled',
    'DeliveryOverdue',
    'DeliveryReturned',
    'TurnReported',
    'DeliveryAbandoned',
    'ShipRetired',
  ] as const)(
    'leaves Needs attention alone for %s',
    (type) => {
      expect(isAttentionChange(type)).toBe(false);
    },
  );
});

describe('isDeclaredRulesChange', () => {
  it('reloads the declared rules for NetworkRulesDeclared', () => {
    expect(isDeclaredRulesChange('NetworkRulesDeclared')).toBe(true);
  });

  it.each(['NetworkRulesSet', 'LabelRetired', 'ShipRetired', 'MessageAccepted'] as const)('leaves the declared rules alone for %s', (type) => {
    expect(isDeclaredRulesChange(type)).toBe(false);
  });
});

describe('isBuiltInRulesChange', () => {
  it.each(['BuiltInRuleChanged', 'NetworkRulesSet'] as const)('reloads the built-in rules for %s, which turns one on or off', (type) => {
    expect(isBuiltInRulesChange(type)).toBe(true);
  });

  it.each(['NetworkRulesDraftSaved', 'NetworkRulesDeclared', 'MessageAccepted'] as const)('leaves the built-in rules alone for %s', (type) => {
    expect(isBuiltInRulesChange(type)).toBe(false);
  });
});

describe('isNetworkRulesChange', () => {
  it.each(['NetworkRulesSet', 'NetworkRulesDraftSaved', 'NetworkRulesDraftDiscarded', 'NetworkRulesDeclared', 'BuiltInRuleChanged'] as const)(
    'reloads the network rules, what the draft changes and the reach for %s',
    (type) => {
      expect(isNetworkRulesChange(type)).toBe(true);
    },
  );

  it.each(['LabelAssigned', 'MessageAccepted'] as const)('leaves them alone for %s', (type) => {
    expect(isNetworkRulesChange(type)).toBe(false);
  });
});

describe('live reloads', () => {
  it('reads again after an event that comes while the first read is in flight, which may have read before the change', async () => {
    const queryClient = new QueryClient();
    const reads: ((value: string) => void)[] = [];
    const observer = new QueryObserver(queryClient, {
      queryKey: ['fleet', 'inbox'],
      queryFn: () =>
        new Promise<string>((resolve) => {
          reads.push(resolve);
        }),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await expect.poll(() => reads).toHaveLength(1);

    // An event for a change committed after the first read began.
    createLiveReloads(queryClient)(['fleet']);
    reads[0]?.('before the change');
    await expect.poll(() => reads).toHaveLength(2);
    reads[1]?.('after the change');

    await expect.poll(() => queryClient.getQueryData(['fleet', 'inbox'])).toBe('after the change');
    unsubscribe();
  });

  it('reads again a query that already has data, as an invalidation does', async () => {
    const queryClient = new QueryClient();
    let reads = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: ['fleet', 'list'],
      queryFn: () => {
        reads += 1;
        return Promise.resolve(`read ${String(reads)}`);
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await expect.poll(() => queryClient.getQueryData(['fleet', 'list'])).toBe('read 1');

    createLiveReloads(queryClient)(['fleet']);

    await expect.poll(() => queryClient.getQueryData(['fleet', 'list'])).toBe('read 2');
    unsubscribe();
  });

  it('keeps one read of a query in flight for a burst of events, and reads once more after it for the events that came meanwhile (#1027)', async () => {
    const queryClient = new QueryClient();
    const reads: ((value: string) => void)[] = [];
    let inFlight = 0;
    let mostInFlight = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: ['fleet', 'list'],
      queryFn: () =>
        new Promise<string>((resolve) => {
          inFlight += 1;
          mostInFlight = Math.max(mostInFlight, inFlight);
          reads.push((value) => {
            inFlight -= 1;
            resolve(value);
          });
        }),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await expect.poll(() => reads).toHaveLength(1);
    reads[0]?.('first');
    await expect.poll(() => queryClient.getQueryData(['fleet', 'list'])).toBe('first');
    const reload = createLiveReloads(queryClient);

    reload(['fleet']);
    await expect.poll(() => reads).toHaveLength(2);
    for (let event = 0; event < 25; event += 1) {
      reload(['fleet']);
    }
    reads[1]?.('during the burst');
    await expect.poll(() => reads).toHaveLength(3);
    reads[2]?.('after the burst');

    await expect.poll(() => queryClient.getQueryData(['fleet', 'list'])).toBe('after the burst');
    expect(reads).toHaveLength(3);
    expect(mostInFlight).toBe(1);
    unsubscribe();
  });
});

const newId = createIdGenerator();
const SERVER = 'http://fleet.test/trpc';
/** Long enough for a reload an event asks for to reach the server. */
const SETTLE_MS = 50;

function aShip(ship: Partial<ListedShip>): ListedShip {
  return {
    id: newId('ship'),
    name: 'builder',
    type: 'builder',
    kind: 'agent',
    status: 'crewed',
    startingPrompt: null,
    location: null,
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: [], retiredAt: null, ownerShipId: null,
    ...ship,
  };
}

function anEvent(type: EventType, about: { shipId: ShipId | null; hasMessage: boolean }): LiveFleetEvent {
  return {
    seq: 1,
    id: newId('event'),
    type,
    occurredAt: '2026-10-23T05:00:00.000Z',
    actorKind: 'ship',
    actorShipId: null,
    actorAccountId: null,
    actorSignedInAccountId: null,
    shipId: about.shipId,
    messageId: about.hasMessage ? newId('message') : null,
    deliveryId: about.hasMessage ? newId('delivery') : null,
  };
}

/**
 * The live handler over a fake server: each procedure answers what `answers`
 * gives it for its input, and `asked` counts the calls that reached it.
 */
function aLiveFleet(answers: Readonly<Record<string, (input: unknown) => unknown>>) {
  const asked = new Map<string, number>();
  const fetchFromFleet = (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const procedure = url.pathname.split('/').at(-1) ?? '';
    asked.set(procedure, (asked.get(procedure) ?? 0) + 1);
    const rawInput = url.searchParams.get('input');
    const answer = answers[procedure];
    if (answer === undefined) {
      return Promise.resolve(Response.json({ error: { message: `no ${procedure} here`, code: -32004, data: { code: 'NOT_FOUND', httpStatus: 404 } } }, { status: 404 }));
    }
    return Promise.resolve(Response.json({ result: { data: answer(rawInput === null ? undefined : JSON.parse(rawInput)) } }));
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpc = createTRPCOptionsProxy<AppRouter>({ client: createTRPCClient<AppRouter>({ links: [httpLink({ url: SERVER, fetch: fetchFromFleet })] }), queryClient });
  const highlighted: ShipId[] = [];
  const onItem = createLiveFleetHandler({
    trpc,
    queryClient,
    reload: createLiveReloads(queryClient),
    onPlacedFirst: (shipId) => {
      highlighted.push(shipId);
    },
  });
  const shown: (() => void)[] = [];
  return {
    trpc,
    queryClient,
    onItem,
    /** The ships the overview highlights, in the order they were placed first. */
    highlighted,
    askedOf: (procedure: string) => asked.get(procedure) ?? 0,
    /** Shows a read on the page, as a part that asks it does. */
    show: (observer: { subscribe: (listener: () => void) => () => void }) => {
      shown.push(observer.subscribe(() => undefined));
    },
    close: () => {
      shown.forEach((unsubscribe) => {
        unsubscribe();
      });
    },
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

describe('the live fleet (performance design, decision 3)', () => {
  it('reloads neither fleet.list nor the full health for any event', async () => {
    const builder = aShip({});
    const live = aLiveFleet({ 'fleet.list': () => [builder], 'fleet.health': () => ({}), 'fleet.listedShip': () => builder, 'fleet.stuckCount': () => ({ count: 0, oldestSince: null }) });
    live.show(new QueryObserver(live.queryClient, live.trpc.fleet.list.queryOptions()));
    live.show(new QueryObserver(live.queryClient, live.trpc.fleet.health.queryOptions()));
    await expect.poll(() => live.askedOf('fleet.list') + live.askedOf('fleet.health')).toBe(2);

    for (const type of EVENT_TYPES) {
      live.onItem({ kind: 'event', event: anEvent(type, { shipId: builder.id, hasMessage: true }) });
    }
    await settled();

    expect({ list: live.askedOf('fleet.list'), health: live.askedOf('fleet.health') }).toEqual({ list: 1, health: 1 });
    live.close();
  });

  it("replaces a ship's row in place on the overview's loaded pages", async () => {
    const argo = aShip({ name: 'argo', type: 'operator', kind: 'operator' });
    const builder = aShip({ status: 'awaitingCrew' });
    const scout = aShip({ name: 'scout' });
    const live = aLiveFleet({ 'fleet.list': () => ({ items: [argo, builder, scout], nextCursor: 'more' }), 'fleet.listedShip': () => ({ ...builder, status: 'crewed' }) });
    const pages = new InfiniteQueryObserver(live.queryClient, live.trpc.fleet.list.infiniteQueryOptions({ limit: 20 }, { getNextPageParam: () => undefined }));
    live.show(pages);
    await expect.poll(() => pages.getCurrentResult().data).toBeDefined();

    live.onItem({ kind: 'event', event: anEvent('ShipClaimed', { shipId: builder.id, hasMessage: false }) });

    await expect.poll(() => pages.getCurrentResult().data?.pages.flatMap((page) => page.items)).toEqual([argo, { ...builder, status: 'crewed' }, scout]);
    live.close();
  });

  it.each([
    { what: 'a commissioned ship', type: 'ShipCommissioned' },
    { what: 'a changed ship beyond the loaded pages', type: 'ShipClaimed' },
  ] as const)("puts $what first on the overview's loaded pages (#1173)", async ({ type }) => {
    const argo = aShip({ name: 'argo', type: 'operator', kind: 'operator' });
    const builder = aShip({});
    const scout = aShip({ name: 'scout', status: 'awaitingCrew' });
    const live = aLiveFleet({ 'fleet.list': () => ({ items: [argo, builder], nextCursor: 'more' }), 'fleet.listedShip': () => scout });
    const pages = new InfiniteQueryObserver(live.queryClient, live.trpc.fleet.list.infiniteQueryOptions({ limit: 20 }, { getNextPageParam: () => undefined }));
    live.show(pages);
    await expect.poll(() => pages.getCurrentResult().data).toBeDefined();

    live.onItem({ kind: 'event', event: anEvent(type, { shipId: scout.id, hasMessage: false }) });

    await expect.poll(() => pages.getCurrentResult().data?.pages.flatMap((page) => page.items)).toEqual([scout, argo, builder]);
    live.close();
  });

  it("shows a ship it put first once when Load more brings the page that holds it (#1173)", async () => {
    const argo = aShip({ name: 'argo', type: 'operator', kind: 'operator' });
    const builder = aShip({});
    const scout = aShip({ name: 'scout', status: 'awaitingCrew' });
    const live = aLiveFleet({
      'fleet.list': (asked) => (typeof asked === 'object' && asked !== null && 'cursor' in asked && asked.cursor === 'page-2' ? { items: [scout], nextCursor: null } : { items: [argo, builder], nextCursor: 'page-2' }),
      'fleet.listedShip': () => scout,
    });
    const pages = new InfiniteQueryObserver(live.queryClient, live.trpc.fleet.list.infiniteQueryOptions({ limit: 20 }, { getNextPageParam: (page) => page.nextCursor ?? undefined }));
    live.show(pages);
    await expect.poll(() => pages.getCurrentResult().data).toBeDefined();
    live.onItem({ kind: 'event', event: anEvent('ShipClaimed', { shipId: scout.id, hasMessage: false }) });
    await expect.poll(() => pages.getCurrentResult().data?.pages[0]?.items[0]).toEqual(scout);

    await pages.fetchNextPage();

    expect(uniqueById(pages.getCurrentResult().data?.pages.flatMap((page) => page.items) ?? [])).toEqual([scout, argo, builder]);
    live.close();
  });

  it("highlights a ship it puts first on the overview's loaded pages (#1173)", async () => {
    const argo = aShip({ name: 'argo', type: 'operator', kind: 'operator' });
    const scout = aShip({ name: 'scout', status: 'awaitingCrew' });
    const live = aLiveFleet({ 'fleet.list': () => ({ items: [argo], nextCursor: 'more' }), 'fleet.listedShip': () => scout });
    const pages = new InfiniteQueryObserver(live.queryClient, live.trpc.fleet.list.infiniteQueryOptions({ limit: 20 }, { getNextPageParam: () => undefined }));
    live.show(pages);
    await expect.poll(() => pages.getCurrentResult().data).toBeDefined();

    live.onItem({ kind: 'event', event: anEvent('ShipClaimed', { shipId: scout.id, hasMessage: false }) });

    await expect.poll(() => live.highlighted).toEqual([scout.id]);
    live.close();
  });

  it("highlights no ship the overview's loaded pages already show", async () => {
    const argo = aShip({ name: 'argo', type: 'operator', kind: 'operator' });
    const builder = aShip({ status: 'awaitingCrew' });
    const live = aLiveFleet({ 'fleet.list': () => ({ items: [argo, builder], nextCursor: null }), 'fleet.listedShip': () => ({ ...builder, status: 'crewed' }) });
    const pages = new InfiniteQueryObserver(live.queryClient, live.trpc.fleet.list.infiniteQueryOptions({ limit: 20 }, { getNextPageParam: () => undefined }));
    live.show(pages);
    await expect.poll(() => pages.getCurrentResult().data).toBeDefined();

    live.onItem({ kind: 'event', event: anEvent('ShipClaimed', { shipId: builder.id, hasMessage: false }) });
    await expect.poll(() => live.askedOf('fleet.listedShip')).toBe(1);
    await settled();

    expect(live.highlighted).toEqual([]);
    live.close();
  });

  it.each(['ShipCommissioned', 'ShipClaimed', 'LeaseRevoked', 'ShipRetired', 'CrewRequested'] as const)('reloads the ship counts for %s', async (type) => {
    const builder = aShip({});
    const live = aLiveFleet({ 'fleet.shipCounts': () => [], 'fleet.listedShip': () => builder });
    live.show(new QueryObserver(live.queryClient, live.trpc.fleet.shipCounts.queryOptions()));
    await expect.poll(() => live.askedOf('fleet.shipCounts')).toBe(1);

    live.onItem({ kind: 'event', event: anEvent(type, { shipId: builder.id, hasMessage: false }) });

    await expect.poll(() => live.askedOf('fleet.shipCounts')).toBe(2);
    live.close();
  });

  it.each([
    { what: 'a delivery that moves', type: 'DeliveryReceived', hasMessage: true },
    { what: 'a crew, which changes why a delivery waits', type: 'ShipClaimed', hasMessage: false },
  ] as const)('reloads the stuck count for $what', async ({ type, hasMessage }) => {
    const builder = aShip({});
    const live = aLiveFleet({ 'fleet.stuckCount': () => ({ count: 0, oldestSince: null }), 'fleet.listedShip': () => builder });
    live.show(new QueryObserver(live.queryClient, live.trpc.fleet.stuckCount.queryOptions()));
    await expect.poll(() => live.askedOf('fleet.stuckCount')).toBe(1);

    live.onItem({ kind: 'event', event: anEvent(type, { shipId: builder.id, hasMessage }) });

    await expect.poll(() => live.askedOf('fleet.stuckCount')).toBe(2);
    live.close();
  });

  it.each([
    { what: 'a delivery that moves', type: 'DeliveryReceived', hasMessage: true },
    { what: 'a crew, which changes why a delivery waits', type: 'ShipClaimed', hasMessage: false },
  ] as const)("reloads the stuck summary and each cause's page of stuck places for $what", async ({ type, hasMessage }) => {
    const builder = aShip({});
    const live = aLiveFleet({
      'fleet.stuckSummary': () => ({ count: 0, places: 0, oldestSince: null, byCause: [], byMachine: [] }),
      'fleet.stuck': () => ({ items: [], nextCursor: null }),
      'fleet.listedShip': () => builder,
    });
    live.show(new QueryObserver(live.queryClient, live.trpc.fleet.stuckSummary.queryOptions()));
    live.show(new InfiniteQueryObserver(live.queryClient, live.trpc.fleet.stuck.infiniteQueryOptions({ cause: 'waitingForCrew' }, { getNextPageParam: () => undefined })));
    live.show(new InfiniteQueryObserver(live.queryClient, live.trpc.fleet.stuck.infiniteQueryOptions({ cause: 'undeliverable' }, { getNextPageParam: () => undefined })));
    await expect.poll(() => [live.askedOf('fleet.stuckSummary'), live.askedOf('fleet.stuck')]).toEqual([1, 2]);

    live.onItem({ kind: 'event', event: anEvent(type, { shipId: builder.id, hasMessage }) });

    await expect.poll(() => [live.askedOf('fleet.stuckSummary'), live.askedOf('fleet.stuck')]).toEqual([2, 4]);
    live.close();
  });
});
