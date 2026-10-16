import type { Health, StuckCause } from '@aeolus-fleet/common';

/**
 * What the Health page reads from the fleet's health (decision 0042): the
 * verdict, the causes in their order with one next step per place, the marks
 * on the trend and the shared log scale of the wait strips. Pure, from
 * `fleet.health` as the server shaped it.
 */

export type StuckPlace = Health['stuck'][number];

/** The order the causes show in: what only the operator moves first, what clears by itself last. */
export const CAUSE_ORDER: readonly StuckCause[] = ['noShipCanTake', 'waitingForCrew', 'stalledInFlight', 'undeliverable'];

/** Each cause in one sentence: what it waits on, and what lets it move. */
export const CAUSE_SENTENCES: Record<StuckCause, string> = {
  noShipCanTake: 'Sent to a type with no active ship. Waits until you commission one.',
  waitingForCrew: 'Sent to a ship no session crews. Waits until it is crewed.',
  stalledInFlight: 'Taken by a session that went quiet. Waits until it acknowledges or the ship is released.',
  undeliverable: 'Taken five times, never acknowledged. Waits for you to resend or dismiss.',
};

/** Each cause's own page, from its card. */
export function causePathOf(cause: StuckCause): string {
  return `/fleet-health/${cause}`;
}

/** Whether a route segment names a cause. */
export function isStuckCause(value: string): value is StuckCause {
  return CAUSE_ORDER.some((cause) => cause === value);
}

/** How many deliveries are stuck now: the navigation count. */
export function stuckCount(health: Pick<Health, 'stuck'>): number {
  return health.stuck.reduce((total, place) => total + place.count, 0);
}

const HOURS_A_DAY = 24;

export type Verdict =
  | { kind: 'delivering' }
  | {
      kind: 'stuck';
      count: number;
      places: number;
      /** Since when the oldest stuck delivery waits. */
      since: string;
      /** How many were stuck a day ago, on the trend. */
      dayAgo: number;
    };

/** One answer to "is delivery working": delivering, or how many are stuck in how many places, since when. */
export function verdictOf(health: Health): Verdict {
  const [oldest] = health.stuck.map((place) => place.oldestSince).toSorted();
  if (oldest === undefined) {
    return { kind: 'delivering' };
  }
  const dayAgo = health.stuckPerHour.at(-1 - HOURS_A_DAY)?.count ?? 0;
  return { kind: 'stuck', count: stuckCount(health), places: health.stuck.length, since: oldest, dayAgo };
}

export interface CauseGroup {
  cause: StuckCause;
  count: number;
  places: StuckPlace[];
}

/** The causes with anything stuck, in their order, each with its places oldest first. */
export function causeGroupsOf(health: Pick<Health, 'stuck'>): CauseGroup[] {
  return CAUSE_ORDER.flatMap((cause) => {
    const places = health.stuck.filter((place) => place.cause === cause).toSorted((first, second) => first.oldestSince.localeCompare(second.oldestSince));
    return places.length === 0 ? [] : [{ cause, count: places.reduce((total, place) => total + place.count, 0), places }];
  });
}

/** A place by the name the operator knows: the ship's name, or the type as stored. */
export function placeName(place: StuckPlace['place']): string {
  return place.kind === 'ship' ? place.ship.name : place.type;
}

/** The one next step for a place, on the page where it already lives (#304). */
export function nextStepOf(place: StuckPlace): { label: string; href: string } {
  const where = place.place;
  switch (place.cause) {
    case 'noShipCanTake':
      return { label: `Commission a ${placeName(where)}`, href: '/?commission=new' };
    case 'waitingForCrew':
      return where.kind === 'ship'
        ? { label: 'Get starting prompt', href: `/ships/${where.ship.id}` }
        : { label: 'Open ships of type', href: `/?type=${encodeURIComponent(where.type)}` };
    case 'stalledInFlight':
      if (where.kind === 'ship' && where.machine !== null) {
        return { label: 'Open machine', href: `/trierarchs/${where.machine.id}` };
      }
      return where.kind === 'ship' ? { label: 'Open ship', href: `/ships/${where.ship.id}` } : { label: 'Open ships of type', href: `/?type=${encodeURIComponent(where.type)}` };
    case 'undeliverable':
      return { label: 'Resend or dismiss', href: causePathOf('undeliverable') };
  }
}

const CAUSE_WORDS: Record<StuckCause, string> = {
  noShipCanTake: 'no ship can take',
  waitingForCrew: 'waiting for crew',
  stalledInFlight: 'stalled in flight',
  undeliverable: 'undeliverable',
};

/** A numbered mark on the trend: the hour a place's oldest wait began, within the 7 days. */
export interface TrendMark {
  number: number;
  /** The index of the hour on the trend it falls in. */
  hour: number;
  label: string;
}

/**
 * One mark per place whose oldest wait began within the trend, at the first
 * hour that counts it, oldest first: "mapper: no ship can take".
 */
export function marksOf(health: Health): TrendMark[] {
  const [first] = health.stuckPerHour;
  if (first === undefined) {
    return [];
  }
  return health.stuck
    .filter((place) => place.oldestSince > first.at)
    .toSorted((one, other) => one.oldestSince.localeCompare(other.oldestSince))
    .map((place, index) => ({
      number: index + 1,
      hour: health.stuckPerHour.findIndex((hour) => hour.at >= place.oldestSince),
      label: `${placeName(place.place)}: ${CAUSE_WORDS[place.cause]}`,
    }));
}

const MINUTE_MS = 60_000;
const MINUTES_A_DAY = 24 * 60;

/** The wait strips' shared log scale: 1 min to 7 d, each with its tick. */
export const WAIT_TICKS: readonly { minutes: number; label: string }[] = [
  { minutes: 1, label: '1 min' },
  { minutes: 10, label: '10 min' },
  { minutes: 60, label: '1 h' },
  { minutes: MINUTES_A_DAY, label: '1 d' },
  { minutes: 7 * MINUTES_A_DAY, label: '7 d' },
];

const SCALE_FROM = Math.log(1);
const SCALE_TO = Math.log(7 * MINUTES_A_DAY);

/** Where a wait sits on the scale, 0 to 1: under a minute at the start, over 7 days at the end. */
export function waitPosition(minutes: number): number {
  const at = Math.log(Math.max(minutes, 1));
  return Math.min(Math.max((at - SCALE_FROM) / (SCALE_TO - SCALE_FROM), 0), 1);
}

/** How many minutes a delivery has waited by `now`. */
export function waitMinutes(since: string, now: Date): number {
  return Math.max(0, (now.getTime() - Date.parse(since)) / MINUTE_MS);
}

/** How many deliveries are stuck on the ships each machine crews, by machine id. */
export function stuckByMachine(health: Pick<Health, 'stuck'>): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const place of health.stuck) {
    if (place.place.kind === 'ship' && place.place.machine !== null) {
      counts.set(place.place.machine.id, (counts.get(place.place.machine.id) ?? 0) + place.count);
    }
  }
  return counts;
}

const SECONDS_A_MINUTE = 60;

/** A median wait as the delivering line says it: seconds under a minute, else the console's duration. */
export function medianText(medianMs: number, duration: (from: Date, to: Date) => string): string {
  const seconds = Math.round(medianMs / 1_000);
  return seconds < SECONDS_A_MINUTE ? `${String(seconds)} s` : duration(new Date(0), new Date(medianMs));
}

/** Whether the stuck count rose or fell since a day ago: "Up from 6 a day ago." */
export function trendSentence(verdict: Extract<Verdict, { kind: 'stuck' }>): string {
  if (verdict.count > verdict.dayAgo) {
    return `Up from ${String(verdict.dayAgo)} a day ago.`;
  }
  if (verdict.count < verdict.dayAgo) {
    return `Down from ${String(verdict.dayAgo)} a day ago.`;
  }
  return 'As many as a day ago.';
}

/** What the console knows of a stuck ship besides the health read: when its session was last seen. */
export interface PlaceFacts {
  lastSeenAt: string | null;
}

const STATE_WORDS: Record<StuckPlace['deliveries'][number]['state'], string> = {
  pending: 'pending',
  received: 'received',
  handed: 'handed (pulled)',
  undeliverable: 'undeliverable',
};

/**
 * One line under a place that explains its wait, from facts the console has:
 * the state its deliveries wait in, and when the session or machine was last
 * seen. None when there is nothing to add to the cause.
 */
export function placeNote(place: StuckPlace, read: { facts: PlaceFacts | undefined; since: (at: Date) => string }): string | null {
  const where = place.place;
  if (place.cause !== 'stalledInFlight' || where.kind !== 'ship') {
    return null;
  }
  const states = [...new Set(place.deliveries.map((delivery) => STATE_WORDS[delivery.state]))].join(', ');
  if (where.machine !== null) {
    const seen = where.machine.lastSeenAt === null ? 'never seen' : `last seen ${read.since(new Date(where.machine.lastSeenAt))}`;
    return `${states}, machine ${where.machine.name} ${seen}`;
  }
  const lastSeenAt = read.facts?.lastSeenAt ?? null;
  return lastSeenAt === null ? states : `${states}, session last seen ${read.since(new Date(lastSeenAt))}`;
}

/** A ship's page with one of its messages open, where the drill-down opens a stuck delivery. */
export function messagePathOn(shipId: string, messageId: string): string {
  return `/ships/${shipId}?tab=messages&message=${messageId}`;
}

/** The first line of a payload, as a row shows it. */
export function previewOf(payload: string): string {
  return payload.split('\n', 1)[0]?.trim() ?? '';
}
