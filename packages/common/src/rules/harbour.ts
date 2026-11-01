/**
 * Harbour's four states (docs/design/fleet-overview), in the order its
 * numbers and each group's tiles show them: alerts first, then waiting,
 * working and idle. The server works out a ship's state; the browser only
 * groups and orders by it.
 */
export const HARBOUR_STATES = ['alert', 'waiting', 'working', 'idle'] as const;

export type HarbourState = (typeof HARBOUR_STATES)[number];
