import { createIdGenerator, type ListedShip, type UndeliverableDelivery } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { overviewMetrics, overviewSubtitle } from './overview-metrics';

const newId = createIdGenerator();
const NOW = new Date('2026-10-05T12:00:00.000Z');
const MINUTE_MS = 60_000;

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

function aShip(ship: Partial<ListedShip>): ListedShip {
  return {
    id: newId('ship'),
    name: 'scout',
    type: 'reviewer',
    kind: 'agent',
    status: 'crewed',
    startingPrompt: null,
    location: null,
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: [], retiredAt: null,
    ...ship,
  };
}

function anUndeliverable(since: string): UndeliverableDelivery {
  const party = { id: newId('ship'), name: 'scout' };
  return {
    deliveryId: newId('delivery'),
    attempts: 5,
    since,
    message: { id: newId('message'), sender: party, recipient: { kind: 'ship', ship: party }, inReplyTo: null, sentAt: since, contentType: 'text/plain', isPing: false, payload: 'Run 71' },
  };
}

const argo = aShip({ name: 'argo', type: 'operator', kind: 'operator' });
const viewer = aShip({ name: 'viewer', type: 'viewer', kind: 'viewer' });

describe('overviewMetrics', () => {
  it('counts the active agent ships, crewed and awaiting crew, never argo, the viewer ship or a retired ship', () => {
    const ships = [
      argo,
      viewer,
      aShip({ name: 'builder' }),
      aShip({ name: 'reviewer-1', status: 'awaitingCrew', awaitingCrewSince: minutesAgo(2) }),
      aShip({ name: 'old', status: 'retired' }),
    ];

    expect(overviewMetrics({ ships, undeliverable: [], now: NOW })).toMatchObject({ activeCount: 2, crewedCount: 1, awaitingCount: 1 });
  });

  it('names the ship that has awaited crew longest, and for how long', () => {
    const ships = [
      aShip({ name: 'reviewer-1', status: 'awaitingCrew', awaitingCrewSince: minutesAgo(2) }),
      aShip({ name: 'planner', status: 'awaitingCrew', awaitingCrewSince: minutesAgo(95) }),
    ];

    expect(overviewMetrics({ ships, undeliverable: [], now: NOW }).longestWait).toEqual({ name: 'planner', wait: '1 h 35 min' });
  });

  it('names no longest wait while every active ship is crewed', () => {
    expect(overviewMetrics({ ships: [aShip({})], undeliverable: [], now: NOW }).longestWait).toBeUndefined();
  });

  it('says how long the oldest undeliverable delivery has been undeliverable', () => {
    const undeliverable = [anUndeliverable(minutesAgo(30)), anUndeliverable(minutesAgo(165))];

    expect(overviewMetrics({ ships: [], undeliverable, now: NOW }).oldestUndeliverable).toBe('2 h 45 min');
  });

  it('says no oldest undeliverable without one', () => {
    expect(overviewMetrics({ ships: [], undeliverable: [], now: NOW }).oldestUndeliverable).toBeUndefined();
  });
});

describe('overviewSubtitle', () => {
  it('counts the active ships and argo, and the retired ones', () => {
    const ships = [argo, aShip({}), aShip({ status: 'awaitingCrew' }), aShip({ status: 'retired' })];

    expect(overviewSubtitle({ ships, canCommission: true })).toBe('2 active ships and argo, 1 retired. Changes appear as they happen.');
  });

  it('leaves out retired ships when there are none, and counts one ship as one', () => {
    expect(overviewSubtitle({ ships: [argo, aShip({})], canCommission: true })).toBe('1 active ship and argo. Changes appear as they happen.');
  });

  it('says only argo is there yet, and that commissioned ships appear here', () => {
    expect(overviewSubtitle({ ships: [argo], canCommission: true })).toBe('Only argo so far. Ships you commission appear here.');
  });

  it('says only argo is there yet, without commissioning, to a session that cannot commission', () => {
    expect(overviewSubtitle({ ships: [argo, viewer], canCommission: false })).toBe('Only argo so far.');
  });
});
