import {
  accountIdSchema,
  idSchema,
  type DeliveryHistoryEntry,
  type ListedMessage,
  type MessageDelivery,
  type MessageDetail,
  type Party,
  type ShipDetail,
  type ShipWay,
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
  scopes: ['messages:send', 'messages:receive'],
  report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: [],
  commissionedAt: '2026-09-20T16:02:00Z',
  crewedSince: minutesAgo(11),
  retiredAt: null,
  inFlightDeliveries: 1,
  openDeliveries: 2,
  owner: ARGO,
  ownerShipId: ARGO.id,
  statement: null,
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
  scopes: ['messages:send', 'messages:receive'],
  report: null,
  crewedSince: null,
  awaitingCrewSince: minutesAgo(40),
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
  scopes: ['messages:send', 'messages:receive'],
  report: null,
  commissionedAt: '2026-09-18T08:00:00Z',
  crewedSince: minutesAgo(390),
};

export const RETIRED_SHIP: ShipDetail = {
  ...CREWED_SHIP,
  status: 'retired',
  location: null,
  lastSeenAt: null,
  ping: null,
  scopes: ['messages:send', 'messages:receive'],
  report: null,
  crewedSince: null,
  startingPrompt: null,
  retiredAt: '2026-09-28T14:40:00Z',
};

const fromPlanner = { id: messageId('0001'), sender: PLANNER, recipient: { kind: 'ship' as const, ship: REVIEWER }, contentType: 'text/plain', isPing: false, model: null };
const toPlanner = { id: messageId('0002'), sender: REVIEWER, recipient: { kind: 'ship' as const, ship: PLANNER }, contentType: 'text/plain', isPing: false, model: null };

function event(seq: number, entry: Omit<TimelineEntry, 'seq' | 'id' | 'signedInAccountId'> & Partial<Pick<TimelineEntry, 'signedInAccountId'>>): TimelineEntry {
  return { seq, id: eventId(String(seq).padStart(4, '0')), signedInAccountId: null, ...entry };
}

const pingFromArgo = {
  id: messageId('0003'),
  sender: ARGO,
  recipient: { kind: 'ship' as const, ship: REVIEWER },
  contentType: 'application/vnd.aeolus.ping',
  isPing: true,
  model: null,
};

/** A ping argo sent reviewer-01, which its session took and answered with pong, newest first. */
export const PING_TIMELINE: TimelineEntry[] = [
  event(12, { type: 'DeliveryAcknowledged', occurredAt: minutesAgo(2), actor: REVIEWER, ship: REVIEWER, message: pingFromArgo, details: { answer: 'pong' } }),
  event(11, { type: 'DeliveryHanded', occurredAt: minutesAgo(2), actor: REVIEWER, ship: REVIEWER, message: pingFromArgo, details: {} }),
  event(10, { type: 'MessageAccepted', occurredAt: minutesAgo(3), actor: ARGO, ship: REVIEWER, message: pingFromArgo, details: {} }),
];

/** The account signed in as argo in the stories (decision 0054). */
export const SIGNED_IN_ACCOUNT_ID = accountIdSchema.parse('acc-01mathilde');

/** The ping, sent by argo while an account was signed in as it. */
export const SIGNED_IN_PING_TIMELINE: TimelineEntry[] = PING_TIMELINE.map((entry) => (entry.actor?.id === ARGO.id ? { ...entry, signedInAccountId: SIGNED_IN_ACCOUNT_ID } : entry));

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

function listed(
  suffix: string,
  message: Omit<ListedMessage, 'id' | 'delivery' | 'isPayloadUnreadable' | 'isPayloadSealed'> & { state: ListedMessage['delivery']['state']; claimedBy: Party | null; isPulled?: boolean },
): ListedMessage {
  const { state, claimedBy, isPulled = false, ...rest } = message;
  return { id: messageId(suffix), ...rest, isPayloadUnreadable: false, isPayloadSealed: false, delivery: { id: deliveryId(suffix), state, claimedBy, isPulled } };
}

/** reviewer-01's messages: a question and its answer, and a task from builder-core to its type. */
export const MESSAGES: ListedMessage[] = [
  listed('0002', {
    sender: REVIEWER,
    recipient: { kind: 'ship', ship: PLANNER },
    inReplyTo: null,
    sentAt: minutesAgo(6),
    contentType: 'text/plain', model: null,
    preview: 'Which branch should I review first?',
    state: 'acknowledged',
    claimedBy: PLANNER,
  }),
  listed('0001', {
    sender: PLANNER,
    recipient: { kind: 'ship', ship: REVIEWER },
    inReplyTo: messageId('0002'),
    sentAt: minutesAgo(5),
    contentType: 'text/plain', model: null,
    preview: 'Start with claude/slice-12-ship-page.',
    state: 'acknowledged',
    claimedBy: REVIEWER,
  }),
  listed('0003', {
    sender: BUILDER,
    recipient: { kind: 'type', type: 'reviewer' },
    inReplyTo: null,
    sentAt: minutesAgo(30),
    contentType: 'application/json', model: null,
    preview: '{"task":"review","repo":"web","pr":321}',
    state: 'handed',
    claimedBy: REVIEWER,
    isPulled: true,
  }),
];

/** reviewer-01's messages in a sealed fleet: each payload stored sealed, marked (decision 0068, N1). */
export const SEALED_MESSAGES: ListedMessage[] = MESSAGES.map((message) => ({ ...message, isPayloadSealed: true }));

/** The same with the company key cut off: no preview, each marked unreadable (scenario 25). */
export const KEY_NOT_REACHABLE_MESSAGES: ListedMessage[] = SEALED_MESSAGES.map((message) => ({ ...message, preview: '', isPayloadUnreadable: true }));

/** A message reviewer-01's plugin watcher handed to its agent, and one a plain receive handed (pulled). */
export const HANDED_MESSAGES: ListedMessage[] = [
  listed('0007', {
    sender: PLANNER,
    recipient: { kind: 'ship', ship: REVIEWER },
    inReplyTo: null,
    sentAt: minutesAgo(3),
    contentType: 'text/plain', model: null,
    preview: 'Review the store entry rename.',
    state: 'handed',
    claimedBy: REVIEWER,
  }),
  ...MESSAGES.filter((message) => message.delivery.state === 'handed'),
];

/** A squadron member's check-in at its flagship, and the role the flagship answers with (aeolus-fleet-squadrons' docs/squadrons.md, "Check-in"). */
export const SQUADRON_MESSAGES: ListedMessage[] = [
  listed('0004', {
    sender: REVIEWER,
    recipient: { kind: 'ship', ship: PLANNER },
    inReplyTo: null,
    sentAt: minutesAgo(12),
    contentType: 'application/vnd.aeolus.squadron.check-in+json', model: 'claude-opus-5-5',
    preview: '{"squadron":"hemma-feature-a1b2c3","model":"claude-opus-5-5"}',
    state: 'acknowledged',
    claimedBy: PLANNER,
  }),
  listed('0005', {
    sender: PLANNER,
    recipient: { kind: 'ship', ship: REVIEWER },
    inReplyTo: messageId('0004'),
    sentAt: minutesAgo(11),
    contentType: 'application/vnd.aeolus.squadron.role+json', model: null,
    preview: '{"squadron":"hemma-feature-a1b2c3","role":"reviewer","template":"reviewer@2","charter":"You review every change before it',
    state: 'acknowledged',
    claimedBy: REVIEWER,
  }),
];

/** What a step says of itself beyond who and when: nothing, unless the example sets it. */
const PLAIN_STEP = { by: null, handOverNumber: null, channel: null, isAgain: false, isOnceMore: false, overdue: null, leaseEnd: null } as const;

type StepFields = Pick<DeliveryHistoryEntry, 'type' | 'occurredAt' | 'ship' | 'location' | 'harness' | 'attempts'>;

function history(seq: number, entry: StepFields & Partial<DeliveryHistoryEntry>): DeliveryHistoryEntry {
  return { seq, ...PLAIN_STEP, ...entry };
}

/** The way of a delivery a plain receive handed and that stands on an open pull lease. */
const PULLED_WAY: MessageDetail['delivery']['way'] = {
  holder: { kind: 'agent' },
  since: '2026-09-28T14:20:31Z',
  isPulled: true,
  overdue: null,
  lease: { by: null, isEnded: false, turn: null },
  crew: null,
};

/** A type-addressed delivery: queued, claimed, returned when its crew was released, claimed again. */
export const TYPE_HISTORY: DeliveryHistoryEntry[] = [
  history(14, { type: 'DeliveryHanded', occurredAt: '2026-09-28T14:20:31Z', ship: REVIEWER, location: { kind: 'SERVER', description: 'hetzner-1' }, harness: null, attempts: 2 }),
  history(12, { type: 'DeliveryReturned', occurredAt: '2026-09-28T14:20:02Z', ship: PLANNER, location: null, harness: null, attempts: 1 }),
  history(11, { type: 'DeliveryHanded', occurredAt: '2026-09-28T14:06:15Z', ship: PLANNER, location: { kind: 'DEVICE', description: null }, harness: null, attempts: 1 }),
  history(10, { type: 'MessageAccepted', occurredAt: '2026-09-28T14:05:51Z', ship: null, location: null, harness: null, attempts: null }),
];

/** A direct delivery, acknowledged. */
export const DIRECT_HISTORY: DeliveryHistoryEntry[] = [
  history(9, { type: 'DeliveryAcknowledged', occurredAt: '2026-09-28T14:27:40Z', ship: REVIEWER, location: null, harness: null, attempts: null }),
  history(8, { type: 'DeliveryHanded', occurredAt: '2026-09-28T14:26:12Z', ship: REVIEWER, location: { kind: 'SERVER', description: 'hetzner-1' }, harness: null, attempts: 1 }),
  history(7, { type: 'MessageAccepted', occurredAt: '2026-09-28T14:26:03Z', ship: null, location: null, harness: null, attempts: null }),
];

/** An undeliverable delivery: claimed five times, never acknowledged. */
export const UNDELIVERABLE_HISTORY: DeliveryHistoryEntry[] = [
  history(30, { type: 'DeliveryUndeliverable', occurredAt: '2026-09-28T13:12:40Z', ship: REVIEWER, location: null, harness: null, attempts: 5 }),
  history(29, { type: 'DeliveryHanded', occurredAt: '2026-09-28T13:02:38Z', ship: REVIEWER, location: { kind: 'CLOUD', description: null }, harness: null, attempts: 5 }),
  history(20, { type: 'MessageAccepted', occurredAt: '2026-09-28T12:10:05Z', ship: null, location: null, harness: null, attempts: null }),
];

/** The task from builder-core to any reviewer, claimed by reviewer-01 after planner's crew left. */
export const TYPE_MESSAGE: MessageDetail = {
  id: messageId('0003'),
  sender: BUILDER,
  recipient: { kind: 'type', type: 'reviewer' },
  inReplyTo: null,
  sentAt: '2026-09-28T14:05:51Z',
  contentType: 'application/json', model: null,
  payload: '{"task":"review","repo":"web","pr":321}',
  isPayloadUnreadable: false,
  isPayloadSealed: false,
  replies: [],
  delivery: { id: deliveryId('0003'), state: 'handed', attempts: 2, claimedBy: REVIEWER, way: PULLED_WAY, history: TYPE_HISTORY },
  deliveryCount: 1,
};

/** planner's answer to reviewer-01, acknowledged. */
export const DIRECT_MESSAGE: MessageDetail = {
  id: messageId('0001'),
  sender: PLANNER,
  recipient: { kind: 'ship', ship: REVIEWER },
  inReplyTo: messageId('0002'),
  sentAt: '2026-09-28T14:26:03Z',
  contentType: 'text/plain', model: null,
  payload: 'Start with claude/slice-12-ship-page.',
  isPayloadUnreadable: false,
  isPayloadSealed: false,
  replies: [],
  delivery: {
    id: deliveryId('0001'),
    state: 'acknowledged',
    attempts: 1,
    claimedBy: REVIEWER,
    way: { ...PULLED_WAY, since: '2026-09-28T14:27:40Z' },
    history: DIRECT_HISTORY,
  },
  deliveryCount: 1,
};

/** A second reviewer, which carries team=a in the label example. */
export const SECOND_REVIEWER: Party = { id: shipId('q7m1'), name: 'reviewer-02' };

/** planner's "main is red" to every ship carrying team=a (decision 0065): one delivery per ship, each on its own. */
export const LABEL_MESSAGE: MessageDetail = {
  id: messageId('0005'),
  sender: PLANNER,
  recipient: { kind: 'label', values: [{ valueId: idSchema('labelValue').parse('lbv_01j8xk4tqzr3a9w6m2v5n7te4a'), key: 'team', value: 'a' }] },
  inReplyTo: null,
  sentAt: '2026-09-28T14:26:03Z',
  contentType: 'text/plain',
  model: 'claude-opus-5-5',
  payload: 'main is red',
  isPayloadUnreadable: false,
  isPayloadSealed: false,
  replies: [],
  delivery: {
    id: deliveryId('0051'),
    state: 'acknowledged',
    attempts: 1,
    claimedBy: REVIEWER,
    way: { ...PULLED_WAY, since: '2026-09-28T14:27:40Z' },
    history: DIRECT_HISTORY,
  },
  deliveryCount: 3,
};

/** The deliveries of LABEL_MESSAGE, by id: one per ship carrying team=a. */
export const LABEL_DELIVERIES: MessageDelivery[] = [
  { id: deliveryId('0051'), ship: REVIEWER, state: 'acknowledged', since: '2026-09-28T14:27:40Z' },
  { id: deliveryId('0052'), ship: BUILDER, state: 'handed', since: '2026-09-28T14:28:10Z' },
  { id: deliveryId('0053'), ship: SECOND_REVIEWER, state: 'pending', since: '2026-09-28T14:26:03Z' },
];

/** The trierarch on mac-mini, which crews reviewer-01 in the pushed examples. */
export const MAC_MINI: Party = { id: shipId('mm01'), name: 'mac-mini' };
const AT_MAC_MINI = { kind: 'trierarch', trierarch: MAC_MINI } as const;
const WATCHER = { kind: 'pluginWatcher' } as const;

/** An ISO time this many seconds after another. */
function secondsAfter(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1_000).toISOString();
}

/** A pushed message's way through at its happy path (2b): stored, received, handed, acknowledged, handled, with its reply. */
const STORED_AT = minutesAgo(9);
export const PUSHED_HANDLED_HISTORY: DeliveryHistoryEntry[] = [
  history(46, { type: 'DeliveryHandled', occurredAt: secondsAfter(STORED_AT, 364), ship: REVIEWER, location: null, harness: null, attempts: null }),
  history(45, { type: 'DeliveryAcknowledged', occurredAt: secondsAfter(STORED_AT, 4), ship: REVIEWER, location: null, harness: null, attempts: null }),
  history(44, {
    type: 'DeliveryHanded',
    occurredAt: secondsAfter(STORED_AT, 2),
    ship: REVIEWER,
    location: { kind: 'DEVICE', description: 'mac-mini' },
    harness: 'claude-code',
    attempts: 1,
    by: AT_MAC_MINI,
    handOverNumber: 1,
  }),
  history(43, { type: 'DeliveryReceived', occurredAt: secondsAfter(STORED_AT, 2), ship: REVIEWER, location: null, harness: null, attempts: null, by: AT_MAC_MINI }),
  history(42, { type: 'MessageAccepted', occurredAt: STORED_AT, ship: null, location: null, harness: null, attempts: null }),
];

/** A pushed message from planner to reviewer-01, its way through as the fleet saw it. */
function pushed(suffix: string, delivery: Pick<MessageDetail['delivery'], 'state' | 'attempts' | 'way' | 'history'>): MessageDetail {
  return {
    id: messageId(suffix),
    sender: PLANNER,
    recipient: { kind: 'ship', ship: REVIEWER },
    inReplyTo: null,
    sentAt: delivery.history.at(-1)?.occurredAt ?? STORED_AT,
    contentType: 'text/plain',
    model: 'claude-opus-5-5',
    payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/48',
    isPayloadUnreadable: false,
    isPayloadSealed: false,
    replies: [],
    delivery: { id: deliveryId(suffix), claimedBy: delivery.state === 'pending' ? null : REVIEWER, ...delivery },
    deliveryCount: 1,
  };
}

const PUSHED_LEASE = { by: AT_MAC_MINI, isEnded: false, turn: null };

/** Handled on a session its trierarch crewed, the reply beneath it. */
export const PUSHED_HANDLED_MESSAGE: MessageDetail = {
  ...pushed('0101', {
    state: 'handled',
    attempts: 1,
    way: { holder: null, since: secondsAfter(STORED_AT, 364), isPulled: false, overdue: null, lease: PUSHED_LEASE, crew: { status: 'running', attempt: 0, startedAt: minutesAgo(40) } },
    history: PUSHED_HANDLED_HISTORY,
  }),
  replies: [{ id: messageId('0102'), sender: REVIEWER, sentAt: secondsAfter(STORED_AT, 300) }],
};

/** Received by the trierarch, not handed yet, while its session restarts (3.5). */
export const RECEIVED_RESTARTING_MESSAGE: MessageDetail = pushed('0103', {
  state: 'received',
  attempts: 0,
  way: { holder: AT_MAC_MINI, since: minutesAgo(3), isPulled: false, overdue: null, lease: PUSHED_LEASE, crew: { status: 'restarting', attempt: 2, startedAt: null } },
  history: [
    history(52, { type: 'DeliveryReceived', occurredAt: minutesAgo(1), ship: REVIEWER, location: null, harness: null, attempts: null, by: AT_MAC_MINI, isAgain: true }),
    history(51, { type: 'DeliveryReceived', occurredAt: minutesAgo(3), ship: REVIEWER, location: null, harness: null, attempts: null, by: AT_MAC_MINI }),
    history(50, { type: 'MessageAccepted', occurredAt: minutesAgo(4), ship: null, location: null, harness: null, attempts: null }),
  ],
});

/** Pending while the session is busy, argo told at 60 min (3.4), on a session crewed by hand. */
export const PENDING_BUSY_MESSAGE: MessageDetail = pushed('0104', {
  state: 'pending',
  attempts: 0,
  way: {
    holder: { kind: 'fleet' },
    since: minutesAgo(61),
    isPulled: false,
    overdue: { clock: 'busy', minutes: 60, toldAt: minutesAgo(1) },
    lease: { by: WATCHER, isEnded: false, turn: { turn: 'busy', at: minutesAgo(70) } },
    crew: null,
  },
  history: [
    history(61, { type: 'DeliveryOverdue', occurredAt: minutesAgo(1), ship: REVIEWER, location: null, harness: null, attempts: null, overdue: { clock: 'busy', minutes: 60 } }),
    history(60, { type: 'MessageAccepted', occurredAt: minutesAgo(61), ship: null, location: null, harness: null, attempts: null }),
  ],
});

/** Handed twice by the plugin watcher, never confirmed: argo told at 10 min (3.8, 3.9). */
export const HANDED_NOT_CONFIRMED_MESSAGE: MessageDetail = pushed('0105', {
  state: 'handed',
  attempts: 2,
  way: {
    holder: { kind: 'agent' },
    since: minutesAgo(12),
    isPulled: false,
    overdue: { clock: 'notConfirmed', minutes: 10, toldAt: minutesAgo(2) },
    lease: { by: WATCHER, isEnded: false, turn: null },
    crew: null,
  },
  history: [
    history(75, { type: 'DeliveryOverdue', occurredAt: minutesAgo(2), ship: REVIEWER, location: null, harness: null, attempts: null, overdue: { clock: 'notConfirmed', minutes: 10 } }),
    history(74, { type: 'DeliveryHanded', occurredAt: minutesAgo(12), ship: REVIEWER, location: { kind: 'DEVICE', description: null }, harness: 'claude-code', attempts: 2, by: WATCHER, handOverNumber: 2 }),
    history(73, { type: 'DeliveryHanded', occurredAt: minutesAgo(14), ship: REVIEWER, location: { kind: 'DEVICE', description: null }, harness: 'claude-code', attempts: 1, by: WATCHER, handOverNumber: 1 }),
    history(72, { type: 'DeliveryReceived', occurredAt: minutesAgo(14), ship: REVIEWER, location: null, harness: null, attempts: null, by: WATCHER }),
    history(71, { type: 'MessageAccepted', occurredAt: minutesAgo(15), ship: null, location: null, harness: null, attempts: null }),
  ],
});

/** Acknowledged, its turn died, handed once more, and that turn died too: not handled (3.7). */
export const NOT_HANDLED_MESSAGE: MessageDetail = pushed('0106', {
  state: 'notHandled',
  attempts: 1,
  way: { holder: null, since: minutesAgo(5), isPulled: false, overdue: null, lease: PUSHED_LEASE, crew: { status: 'running', attempt: 1, startedAt: minutesAgo(6) } },
  history: [
    history(85, { type: 'DeliveryNotHandled', occurredAt: minutesAgo(5), ship: REVIEWER, location: null, harness: null, attempts: null }),
    history(84, { type: 'DeliveryHanded', occurredAt: minutesAgo(6), ship: REVIEWER, location: { kind: 'DEVICE', description: 'mac-mini' }, harness: 'claude-code', attempts: 1, by: AT_MAC_MINI, handOverNumber: 2, isOnceMore: true }),
    history(83, { type: 'DeliveryAcknowledged', occurredAt: minutesAgo(9), ship: REVIEWER, location: null, harness: null, attempts: null }),
    history(82, { type: 'DeliveryHanded', occurredAt: minutesAgo(9), ship: REVIEWER, location: { kind: 'DEVICE', description: 'mac-mini' }, harness: 'claude-code', attempts: 1, by: AT_MAC_MINI, handOverNumber: 1 }),
    history(81, { type: 'DeliveryReceived', occurredAt: minutesAgo(9), ship: REVIEWER, location: null, harness: null, attempts: null, by: AT_MAC_MINI }),
    history(80, { type: 'MessageAccepted', occurredAt: minutesAgo(10), ship: null, location: null, harness: null, attempts: null }),
  ],
});

/** Acknowledged, then the ship was released before its turn ended: handled unknown (3.11). */
export const LEASE_ENDED_MESSAGE: MessageDetail = pushed('0107', {
  state: 'acknowledged',
  attempts: 1,
  way: { holder: { kind: 'agent' }, since: minutesAgo(20), isPulled: false, overdue: null, lease: { ...PUSHED_LEASE, isEnded: true }, crew: null },
  history: [
    history(93, { type: 'DeliveryAcknowledged', occurredAt: minutesAgo(20), ship: REVIEWER, location: null, harness: null, attempts: null }),
    history(92, { type: 'DeliveryHanded', occurredAt: minutesAgo(20), ship: REVIEWER, location: { kind: 'DEVICE', description: 'mac-mini' }, harness: 'claude-code', attempts: 1, by: AT_MAC_MINI, handOverNumber: 1 }),
    history(91, { type: 'DeliveryReceived', occurredAt: minutesAgo(21), ship: REVIEWER, location: null, harness: null, attempts: null, by: AT_MAC_MINI }),
    history(90, { type: 'MessageAccepted', occurredAt: minutesAgo(21), ship: null, location: null, harness: null, attempts: null }),
  ],
});

/** Back to pending when the ship was released while it was handed (3.11). */
export const RETURNED_HISTORY: DeliveryHistoryEntry[] = [
  history(103, { type: 'DeliveryReturned', occurredAt: minutesAgo(2), ship: REVIEWER, location: null, harness: null, attempts: 1, leaseEnd: 'released' }),
  history(102, { type: 'DeliveryHanded', occurredAt: minutesAgo(4), ship: REVIEWER, location: { kind: 'DEVICE', description: null }, harness: 'claude-code', attempts: 1, by: WATCHER, handOverNumber: 1 }),
  history(101, { type: 'DeliveryReceived', occurredAt: minutesAgo(4), ship: REVIEWER, location: null, harness: null, attempts: null, by: WATCHER }),
  history(100, { type: 'MessageAccepted', occurredAt: minutesAgo(5), ship: null, location: null, harness: null, attempts: null }),
];

/** A ping from argo, handed, not answered yet (3.17). */
export const PING_WAITING_MESSAGE: MessageDetail = {
  ...pushed('0108', {
    state: 'handed',
    attempts: 1,
    way: { holder: { kind: 'agent' }, since: minutesAgo(1), isPulled: false, overdue: null, lease: PUSHED_LEASE, crew: null },
    history: [
      history(112, { type: 'DeliveryHanded', occurredAt: minutesAgo(1), ship: REVIEWER, location: null, harness: null, attempts: 1, by: AT_MAC_MINI, handOverNumber: 1 }),
      history(111, { type: 'MessageAccepted', occurredAt: minutesAgo(3), ship: null, location: null, harness: null, attempts: null }),
    ],
  }),
  sender: ARGO,
  contentType: 'application/vnd.aeolus.ping',
  payload: '',
};

export const UNKNOWN_MESSAGE_ID = messageId('9999');
export const UNKNOWN_SHIP_ID = shipId('zzzz');

/** A ship's side of the way, its oldest delivery waiting taken from a message's way. */
function shipWay(lease: ShipWay['lease'], waiting: { count: number; oldest?: MessageDetail }): ShipWay {
  const { count, oldest } = waiting;
  return {
    lease,
    waiting: count,
    oldest: oldest
      ? {
          messageId: oldest.id,
          sentAt: oldest.sentAt,
          contentType: oldest.contentType,
          delivery: { id: oldest.delivery.id, state: oldest.delivery.state, attempts: oldest.delivery.attempts, way: oldest.delivery.way },
        }
      : null,
  };
}

/** Served by the plugin watcher of a session crewed by hand, busy, its oldest pending past 60 min: argo told (3.4). */
export const WATCHER_BUSY_WAY: ShipWay = shipWay({ by: WATCHER, turn: { turn: 'busy', at: minutesAgo(70) } }, { count: 1, oldest: PENDING_BUSY_MESSAGE });

/** Served by the plugin watcher, idle, its oldest of three handed and never confirmed: argo told at 10 min (3.8). */
export const HANDED_OVERDUE_WAY: ShipWay = shipWay({ by: WATCHER, turn: { turn: 'idle', at: minutesAgo(13) } }, { count: 3, oldest: HANDED_NOT_CONFIRMED_MESSAGE });

/** Served by the trierarch on mac-mini, idle, its oldest received while the session restarts (3.5). */
export const TRIERARCH_WAY: ShipWay = shipWay({ by: AT_MAC_MINI, turn: { turn: 'idle', at: minutesAgo(20) } }, { count: 1, oldest: RECEIVED_RESTARTING_MESSAGE });

/** Served by the trierarch on mac-mini, idle, nothing waiting. */
export const NOTHING_WAITING_WAY: ShipWay = shipWay({ by: AT_MAC_MINI, turn: { turn: 'idle', at: minutesAgo(4) } }, { count: 0 });

/** A pull lease, no trierarch and no plugin, its oldest handed (pulled) and not acknowledged (4.4). */
export const PULL_WAY: ShipWay = shipWay({ by: null, turn: null }, { count: 1, oldest: TYPE_MESSAGE });

/** No session crews the ship. */
export const NOT_CREWED_WAY: ShipWay = { lease: null, waiting: 0, oldest: null };
