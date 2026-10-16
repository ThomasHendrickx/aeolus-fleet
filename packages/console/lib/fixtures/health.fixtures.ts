import { idSchema, type Health } from '@aeolus-fleet/common';

/**
 * The harbour fleet of the Health mock-ups (#304, direction A): 9 deliveries
 * stuck in 5 places at 16 Oct, 11:32, and a fleet where nothing is stuck.
 */

export const HEALTH_NOW = new Date('2026-10-16T11:32:00.000Z');

const MINUTE_MS = 60_000;

function minutesAgo(minutes: number): string {
  return new Date(HEALTH_NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

function hoursAgo(hours: number): string {
  return minutesAgo(hours * 60);
}

function ship(id: string, name: string) {
  return { id: idSchema('ship').parse(id), name };
}

export const SCOUT = ship('shp_01m50fadab99nv2shqvz0sf201', 'scout-01');
export const BUILDER = ship('shp_01m50fadab99nv2shqvz0sf202', 'builder-02');
export const DOCS_WRITER = ship('shp_01m50fadab99nv2shqvz0sf203', 'docs-writer');
export const TESTER = ship('shp_01m50fadab99nv2shqvz0sf204', 'tester-01');
export const HETZNER = { ...ship('shp_01m50fadab99nv2shqvz0sf205', 'hetzner-01'), lastSeenAt: minutesAgo(38) };

let serial = 0;

/** A stuck delivery waiting since the given minutes ago. */
function waiting(minutes: number, state: 'pending' | 'received' | 'handed' | 'undeliverable') {
  serial += 1;
  const suffix = String(serial).padStart(2, '0');
  return {
    deliveryId: idSchema('delivery').parse(`dlv_01m50fadab99nv2shqvz0sf2${suffix}`),
    messageId: idSchema('message').parse(`msg_01m50fadab99nv2shqvz0sf2${suffix}`),
    state,
    since: minutesAgo(minutes),
  };
}

/** Stuck deliveries per hour over the 7 days: the mock-up's step line, 9 now and 6 a day ago. */
function trend(): Health['stuckPerHour'] {
  return Array.from({ length: 168 }, (_unused, index) => {
    const ago = 167 - index;
    let count = 0;
    if (ago <= 140 && ago > 137) count = 1;
    if (ago <= 101 && ago > 100) count = 2;
    if (ago <= 43) count = 2;
    if (ago <= 33) count += 4;
    if (ago <= 21) count += 1;
    if (ago <= 0) count += 2;
    return { at: hoursAgo(ago), count };
  });
}

/** Acknowledged per hour over the last 24, oldest first. */
const ACKNOWLEDGED_PER_HOUR = [9, 11, 8, 6, 4, 3, 2, 2, 3, 7, 12, 14, 15, 13, 12, 14, 16, 13, 11, 10, 12, 10, 9, 11];

function acknowledged(counts: readonly number[]): Health['acknowledged'] {
  return {
    count: counts.reduce((total, count) => total + count, 0),
    medianMs: 6_000,
    perHour: counts.map((count, index) => ({ at: hoursAgo(23 - index), count })),
  };
}

export const STUCK_HEALTH: Health = {
  stuck: [
    { cause: 'noShipCanTake', place: { kind: 'type', type: 'mapper' }, count: 2, oldestSince: minutesAgo(43 * 60), deliveries: [waiting(43 * 60, 'pending'), waiting(43 * 60 - 2, 'pending')] },
    {
      cause: 'waitingForCrew',
      place: { kind: 'ship', ship: DOCS_WRITER, machine: null },
      count: 3,
      oldestSince: minutesAgo(33 * 60),
      deliveries: [waiting(33 * 60, 'pending'), waiting(33 * 60 - 2, 'pending'), waiting(33 * 60 - 4, 'pending')],
    },
    { cause: 'stalledInFlight', place: { kind: 'ship', ship: SCOUT, machine: null }, count: 1, oldestSince: minutesAgo(33 * 60), deliveries: [waiting(33 * 60, 'handed')] },
    { cause: 'undeliverable', place: { kind: 'ship', ship: TESTER, machine: null }, count: 1, oldestSince: minutesAgo(21 * 60), deliveries: [waiting(21 * 60, 'undeliverable')] },
    { cause: 'stalledInFlight', place: { kind: 'ship', ship: BUILDER, machine: HETZNER }, count: 2, oldestSince: minutesAgo(40), deliveries: [waiting(40, 'received'), waiting(39, 'received')] },
  ],
  stuckPerHour: trend(),
  acknowledged: acknowledged(ACKNOWLEDGED_PER_HOUR),
};

export const DELIVERING_HEALTH: Health = {
  stuck: [],
  stuckPerHour: trend().map((hour, index) => ({ ...hour, count: index > 20 && index < 24 ? 1 : 0 })),
  acknowledged: acknowledged(ACKNOWLEDGED_PER_HOUR),
};

/** A fleet that has acknowledged nothing in the last 24 hours, and has nothing stuck. */
export const QUIET_HEALTH: Health = {
  stuck: [],
  stuckPerHour: trend().map((hour) => ({ ...hour, count: 0 })),
  acknowledged: { count: 0, medianMs: null, perHour: ACKNOWLEDGED_PER_HOUR.map((_count, index) => ({ at: hoursAgo(23 - index), count: 0 })) },
};
