import type { Read } from './read-measurement.ts';

/** Where a run measures, and who it is: the tokens come from the environment and are never printed. */
export interface Target {
  url: string;
  fleetToken: string;
  installationToken: string;
  fleetId: string;
}

const FLEET_ID = '<fleet id>';

/**
 * The reads of the performance design that need no id of a ship or a message: what a console page, the shared header and an
 * installation caller read. A name the server no longer answers shows as errors, never as a missing row.
 */
export const READS: readonly Read[] = [
  { name: 'fleet.health', procedure: 'fleet.health', credential: 'fleet' },
  { name: 'fleet.stuckCount', procedure: 'fleet.stuckCount', credential: 'fleet' },
  { name: 'fleet.stuckSummary', procedure: 'fleet.stuckSummary', credential: 'fleet' },
  { name: 'fleet.stuckHistory', procedure: 'fleet.stuckHistory', credential: 'fleet' },
  { name: 'fleet.acknowledged', procedure: 'fleet.acknowledged', credential: 'fleet' },
  { name: 'fleet.list', procedure: 'fleet.list', input: { limit: 20 }, credential: 'fleet' },
  { name: 'fleet.shipCounts', procedure: 'fleet.shipCounts', credential: 'fleet' },
  { name: 'fleet.labels', procedure: 'fleet.labels', credential: 'fleet' },
  { name: 'fleet.scopes', procedure: 'fleet.scopes', credential: 'fleet' },
  { name: 'fleet.inbox', procedure: 'fleet.inbox', input: { filter: 'open', limit: 20 }, credential: 'fleet' },
  { name: 'fleet.needsAttention', procedure: 'fleet.needsAttention', input: { limit: 20 }, credential: 'fleet' },
  { name: 'installation.fleets.list', procedure: 'installation.fleets.list', credential: 'installation' },
  { name: 'installation.fleets.get', procedure: 'installation.fleets.get', input: { fleetId: FLEET_ID }, credential: 'installation' },
];

/** The GET of a read on tRPC's plain JSON wire: its input in the query, its credential in the headers. */
export function requestOf(read: Read, target: Target): { url: string; headers: Record<string, string> } {
  const base = `${target.url.replace(/\/+$/, '')}/trpc/${read.procedure}`;
  const input = read.input === undefined ? undefined : JSON.stringify(read.input).replaceAll(FLEET_ID, target.fleetId);
  return {
    url: input === undefined ? base : `${base}?input=${encodeURIComponent(input)}`,
    headers:
      read.credential === 'fleet'
        ? { authorization: `Bearer ${target.fleetToken}` }
        : { 'x-aeolus-installation-token': target.installationToken, 'aeolus-fleet': target.fleetId },
  };
}
