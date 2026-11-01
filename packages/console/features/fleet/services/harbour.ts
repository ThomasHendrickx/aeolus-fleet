import type { HarbourOutput, ShipKind } from '@aeolus-fleet/common';
import { HARBOUR_STATES } from '@aeolus-fleet/common/rules';

import { uniqueById } from '../../../lib/paged-list';

/**
 * Harbour's groups (docs/design/fleet-overview): the tiles `fleet.harbour`
 * answers, each with the state the server worked out, grouped by kind and
 * ordered in each group alerts first, then waiting, working and idle, each
 * by name.
 */
export const HARBOUR_GROUPS = ['people', 'agents', 'plugins', 'gateway'] as const;

export type HarbourGroupKind = (typeof HARBOUR_GROUPS)[number];

export type HarbourTile = HarbourOutput['items'][number];

export type HarbourCounts = NonNullable<HarbourOutput['counts']>;

export interface HarbourGroup {
  kind: HarbourGroupKind;
  tiles: HarbourTile[];
}

/** What Harbour shows: the numbers and the groups. */
export interface Harbour {
  counts: HarbourCounts;
  groups: HarbourGroup[];
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

function byStateThenName(first: HarbourTile, second: HarbourTile): number {
  return HARBOUR_STATES.indexOf(first.state) - HARBOUR_STATES.indexOf(second.state) || first.name.localeCompare(second.name);
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
    return ofKind.length === 0 ? [] : [{ kind, tiles: ofKind.toSorted(byStateThenName) }];
  });
}
