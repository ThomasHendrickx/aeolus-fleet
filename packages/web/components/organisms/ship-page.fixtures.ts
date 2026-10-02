import {
  idSchema,
  type DeliveryHistoryEntry,
  type ListedMessage,
  type MessageDetail,
  type Party,
  type ShipDetail,
  type TimelineEntry,
} from '@aeolus-fleet/common';

/** Example data for the ship page's stories: reviewer-01 and the ships it talks to. */

export const NOW = new Date('2026-09-28T14:31:00Z');
const MINUTE_MS = 60_000;

/** An ISO time this many minutes before NOW. */
export function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

const shipId = (suffix: string) => idSchema('ship').parse(`shp_01j8xk4tqzr3a9w6m2v5n7${suffix}`);
const messageId = (suffix: string) => idSchema('message').parse(`msg_01j8zd2vqzr3a9w6m2v5n7${suffix}`);
const deliveryId = (suffix: string) => idSchema('delivery').parse(`dlv_01j8zd2vqzr3a9w6m2v5n7${suffix}`);
const eventId = (suffix: string) => idSchema('event').parse(`evt_01j8zd2vqzr3a9w6m2v5n7${suffix}`);

export const REVIEWER: Party = { id: shipId('yb4c'), name: 'reviewer-01' };
export const PLANNER: Party = { id: shipId('6s9d'), name: 'planner' };
export const BUILDER: Party = { id: shipId('3k2p'), name: 'builder-core' };
export const ARGO: Party = { id: shipId('a7g0'), name: 'argo' };

export const CREWED_SHIP: ShipDetail = {
  id: REVIEWER.id,
  name: REVIEWER.name,
  type: 'reviewer',
  kind: 'agent',
  status: 'crewed',
  startingPrompt: { issuedAt: minutesAgo(15), isClaimed: true },
  location: { kind: 'SERVER', description: 'hetzner-1' },
  lastSeenAt: new Date(NOW.getTime() - 20_000).toISOString(),
  ping: null,
  commissionedAt: '2026-09-20T16:02:00Z',
  crewedSince: minutesAgo(11),
  retiredAt: null,
  inFlightDeliveries: 1,
  openDeliveries: 2,
};

export const AWAITING_SHIP: ShipDetail = {
  ...CREWED_SHIP,
  id: shipId('tr1g'),
  name: 'triage-bot',
  type: 'triage',
  status: 'awaitingCrew',
  startingPrompt: null,
  location: null,
  lastSeenAt: null,
  ping: null,
  crewedSince: null,
};

export const ARGO_SHIP: ShipDetail = {
  ...CREWED_SHIP,
  id: ARGO.id,
  name: ARGO.name,
  type: 'operator',
  kind: 'operator',
  startingPrompt: null,
  location: { kind: 'OTHER', description: 'web console' },
  lastSeenAt: null,
  ping: null,
  commissionedAt: '2026-09-18T08:00:00Z',
  crewedSince: minutesAgo(390),
};

export const RETIRED_SHIP: ShipDetail = {
  ...CREWED_SHIP,
  status: 'retired',
  location: null,
  lastSeenAt: null,
  ping: null,
  crewedSince: null,
  startingPrompt: null,
  retiredAt: '2026-09-28T14:40:00Z',
};

const fromPlanner = { id: messageId('0001'), sender: PLANNER, recipient: { kind: 'ship' as const, ship: REVIEWER }, contentType: 'text/plain' };
const toPlanner = { id: messageId('0002'), sender: REVIEWER, recipient: { kind: 'ship' as const, ship: PLANNER }, contentType: 'text/plain' };

function event(seq: number, entry: Omit<TimelineEntry, 'seq' | 'id'>): TimelineEntry {
  return { seq, id: eventId(String(seq).padStart(4, '0')), ...entry };
}

/** reviewer-01's timeline, newest first. */
export const TIMELINE: TimelineEntry[] = [
  event(9, { type: 'DeliveryAcknowledged', occurredAt: minutesAgo(4), actor: REVIEWER, ship: REVIEWER, message: fromPlanner, details: {} }),
  event(8, { type: 'MessageAccepted', occurredAt: minutesAgo(5), actor: PLANNER, ship: REVIEWER, message: fromPlanner, details: {} }),
  event(7, { type: 'MessageAccepted', occurredAt: minutesAgo(6), actor: REVIEWER, ship: PLANNER, message: toPlanner, details: {} }),
  event(6, {
    type: 'ShipClaimed',
    occurredAt: minutesAgo(10),
    actor: REVIEWER,
    ship: REVIEWER,
    message: null,
    details: { location: 'SERVER', locationDescription: 'hetzner-1' },
  }),
  event(5, { type: 'StartingPromptIssued', occurredAt: minutesAgo(11), actor: ARGO, ship: REVIEWER, message: null, details: {} }),
  event(4, {
    type: 'LeaseRevoked',
    occurredAt: minutesAgo(11),
    actor: ARGO,
    ship: REVIEWER,
    message: null,
    details: { reason: 'released', returnedDeliveries: 1 },
  }),
  event(1, {
    type: 'ShipCommissioned',
    occurredAt: '2026-09-20T16:02:00Z',
    actor: ARGO,
    ship: REVIEWER,
    message: null,
    details: { name: 'reviewer-01', type: 'reviewer', kind: 'agent' },
  }),
];

function listed(suffix: string, message: Omit<ListedMessage, 'id' | 'delivery'> & { state: ListedMessage['delivery']['state']; claimedBy: Party | null }): ListedMessage {
  const { state, claimedBy, ...rest } = message;
  return { id: messageId(suffix), ...rest, delivery: { id: deliveryId(suffix), state, claimedBy } };
}

/** reviewer-01's messages: a question and its answer, and a task from builder-core to its type. */
export const MESSAGES: ListedMessage[] = [
  listed('0002', {
    sender: REVIEWER,
    recipient: { kind: 'ship', ship: PLANNER },
    inReplyTo: null,
    sentAt: minutesAgo(6),
    contentType: 'text/plain',
    preview: 'Which branch should I review first?',
    state: 'acknowledged',
    claimedBy: PLANNER,
  }),
  listed('0001', {
    sender: PLANNER,
    recipient: { kind: 'ship', ship: REVIEWER },
    inReplyTo: messageId('0002'),
    sentAt: minutesAgo(5),
    contentType: 'text/plain',
    preview: 'Start with claude/slice-12-ship-page.',
    state: 'acknowledged',
    claimedBy: REVIEWER,
  }),
  listed('0003', {
    sender: BUILDER,
    recipient: { kind: 'type', type: 'reviewer' },
    inReplyTo: null,
    sentAt: minutesAgo(30),
    contentType: 'application/json',
    preview: '{"task":"review","repo":"web","pr":321}',
    state: 'delivered',
    claimedBy: REVIEWER,
  }),
];

function history(seq: number, entry: Omit<DeliveryHistoryEntry, 'seq'>): DeliveryHistoryEntry {
  return { seq, ...entry };
}

/** A type-addressed delivery: queued, claimed, returned when its crew was released, claimed again. */
export const TYPE_HISTORY: DeliveryHistoryEntry[] = [
  history(14, { type: 'DeliveryClaimed', occurredAt: '2026-09-28T14:20:31Z', ship: REVIEWER, location: { kind: 'SERVER', description: 'hetzner-1' }, attempts: 2 }),
  history(12, { type: 'DeliveryReturned', occurredAt: '2026-09-28T14:20:02Z', ship: PLANNER, location: null, attempts: 1 }),
  history(11, { type: 'DeliveryClaimed', occurredAt: '2026-09-28T14:06:15Z', ship: PLANNER, location: { kind: 'DEVICE', description: null }, attempts: 1 }),
  history(10, { type: 'MessageAccepted', occurredAt: '2026-09-28T14:05:51Z', ship: null, location: null, attempts: null }),
];

/** A direct delivery, acknowledged. */
export const DIRECT_HISTORY: DeliveryHistoryEntry[] = [
  history(9, { type: 'DeliveryAcknowledged', occurredAt: '2026-09-28T14:27:40Z', ship: REVIEWER, location: null, attempts: null }),
  history(8, { type: 'DeliveryClaimed', occurredAt: '2026-09-28T14:26:12Z', ship: REVIEWER, location: { kind: 'SERVER', description: 'hetzner-1' }, attempts: 1 }),
  history(7, { type: 'MessageAccepted', occurredAt: '2026-09-28T14:26:03Z', ship: null, location: null, attempts: null }),
];

/** An undeliverable delivery: claimed five times, never acknowledged. */
export const UNDELIVERABLE_HISTORY: DeliveryHistoryEntry[] = [
  history(30, { type: 'DeliveryUndeliverable', occurredAt: '2026-09-28T13:12:40Z', ship: REVIEWER, location: null, attempts: 5 }),
  history(29, { type: 'DeliveryClaimed', occurredAt: '2026-09-28T13:02:38Z', ship: REVIEWER, location: { kind: 'CLOUD', description: null }, attempts: 5 }),
  history(20, { type: 'MessageAccepted', occurredAt: '2026-09-28T12:10:05Z', ship: null, location: null, attempts: null }),
];

/** The task from builder-core to any reviewer, claimed by reviewer-01 after planner's crew left. */
export const TYPE_MESSAGE: MessageDetail = {
  id: messageId('0003'),
  sender: BUILDER,
  recipient: { kind: 'type', type: 'reviewer' },
  inReplyTo: null,
  sentAt: '2026-09-28T14:05:51Z',
  contentType: 'application/json',
  payload: '{"task":"review","repo":"web","pr":321}',
  delivery: { id: deliveryId('0003'), state: 'delivered', attempts: 2, claimedBy: REVIEWER, history: TYPE_HISTORY },
};

/** planner's answer to reviewer-01, acknowledged. */
export const DIRECT_MESSAGE: MessageDetail = {
  id: messageId('0001'),
  sender: PLANNER,
  recipient: { kind: 'ship', ship: REVIEWER },
  inReplyTo: messageId('0002'),
  sentAt: '2026-09-28T14:26:03Z',
  contentType: 'text/plain',
  payload: 'Start with claude/slice-12-ship-page.',
  delivery: { id: deliveryId('0001'), state: 'acknowledged', attempts: 1, claimedBy: REVIEWER, history: DIRECT_HISTORY },
};

export const UNKNOWN_MESSAGE_ID = messageId('9999');
export const UNKNOWN_SHIP_ID = shipId('zzzz');
