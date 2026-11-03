import type { HarbourOutput, ShipKind } from '@aeolus-fleet/common';
import { HARBOUR_STATES, type HarbourState } from '@aeolus-fleet/common/rules';

import { uniqueById } from '../../../lib/paged-list';

/**
 * Harbour's groups and words (docs/design/fleet-overview): the tiles
 * `fleet.harbour` answers, each with the state the server worked out,
 * grouped by kind and ordered in each group alerts first, then awaiting crew, blocked,
 * working and idle, each by last activity, newest first, then by name; and
 * the overview's subtitle from its numbers.
 */
export const HARBOUR_GROUPS = ['people', 'agents', 'plugins', 'gateway'] as const;

export type HarbourGroupKind = (typeof HARBOUR_GROUPS)[number];

export type HarbourTile = HarbourOutput['items'][number];

export type HarbourCounts = NonNullable<HarbourOutput['counts']>;

export interface HarbourGroup {
  kind: HarbourGroupKind;
  tiles: HarbourTile[];
}

/** Which group a ship's kind lands in; fleet.harbour never answers the viewer ship. */
const GROUP_OF_KIND: Record<ShipKind, HarbourGroupKind | null> = {
  operator: 'people',
  person: 'people',
  agent: 'agents',
  plugin: 'plugins',
  app: 'gateway',
  viewer: null,
};

/** A tile's last activity as a time to order by; one that never did anything comes after every other. */
function activityTimeOf(tile: HarbourTile): number {
  return tile.lastActivityAt === null ? Number.NEGATIVE_INFINITY : Date.parse(tile.lastActivityAt);
}

function byStateThenActivityThenName(first: HarbourTile, second: HarbourTile): number {
  const byState = HARBOUR_STATES.indexOf(first.state) - HARBOUR_STATES.indexOf(second.state);
  const byActivity = activityTimeOf(second) - activityTimeOf(first);
  return byState || (Number.isNaN(byActivity) ? 0 : byActivity) || first.name.localeCompare(second.name);
}

/**
 * The groups from every loaded page's tiles, each ship once where it first
 * shows (a live reload puts a new ship on the first page until a refresh),
 * only the kinds with a ship, in the order of HARBOUR_GROUPS.
 */
export function harbourGroupsOf(tiles: readonly HarbourTile[]): HarbourGroup[] {
  const shown = uniqueById(tiles);
  return HARBOUR_GROUPS.flatMap((kind) => {
    const ofKind = shown.filter((tile) => GROUP_OF_KIND[tile.kind] === kind);
    return ofKind.length === 0 ? [] : [{ kind, tiles: ofKind.toSorted(byStateThenActivityThenName) }];
  });
}

/** The subtitle words each state so; working and idle first, as most ships are. */
const SUMMARY_PARTS: readonly { state: HarbourState; words: string }[] = [
  { state: 'working', words: 'working' },
  { state: 'idle', words: 'idle' },
  { state: 'awaitingCrew', words: 'awaiting crew' },
  { state: 'blocked', words: 'blocked' },
  { state: 'alert', words: 'with an alert' },
];

/**
 * The overview's subtitle from Harbour's numbers, as Bridge words them: the
 * ships, then how many are in each state any ship is in; while argo is
 * alone, what comes next.
 */
export function harbourSummaryOf(counts: HarbourCounts, { canCommission }: { canCommission: boolean }): string {
  if (counts.ships <= 1) {
    return canCommission ? 'Only argo so far. Ships you commission appear here.' : 'Only argo so far.';
  }
  const parts = SUMMARY_PARTS.filter(({ state }) => counts[state] > 0).map(({ state, words }) => `${String(counts[state])} ${words}`);
  return `${String(counts.ships)} ships: ${parts.join(', ')}`;
}
