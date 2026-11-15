'use client';

import type { ShipId } from '@aeolus-fleet/common';
import type { useRender } from '@base-ui/react/use-render';

import { HARBOUR_GROUP_LOOK, type HarbourGroupKind } from './harbour-state.js';
import { HarbourTile, type HarbourTileShip } from './harbour-tile.js';

/**
 * The tiles' grid, by Harbour's own width (a container query on Harbour,
 * docs/design/fleet-overview): as many tiles as fit, each between 12rem and
 * 18rem wide (Thomas, #1672). The columns count by 12rem; a column wider than
 * 18rem (two a row, just short of a third) leaves the space beside its tile.
 * Under two tiles' width, on a phone, two a row. Harbour's loading shape
 * draws the same grid.
 */
export const HARBOUR_TILE_GRID = 'grid gap-2 grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] *:max-w-72 @max-[24.5rem]:grid-cols-2';

export interface HarbourGroupProps {
  kind: HarbourGroupKind;
  /** Its ships, in the order given: the app orders them (alert, waiting, working, idle). */
  tiles: readonly HarbourTileShip[];
  /** Each ship's page; none draws tiles that are not links. */
  hrefOf?: (shipId: ShipId) => string;
  link?: useRender.RenderProp;
  now: Date;
}

/** One of Harbour's groups (docs/design/fleet-overview): its icon, word and how many ships it holds, then its tiles. */
export function HarbourGroup({ kind, tiles, hrefOf, link, now }: HarbourGroupProps) {
  const { word, Icon } = HARBOUR_GROUP_LOOK[kind];
  return (
    <section aria-label={word} className="flex flex-col gap-2" data-testid={`harbour-group-${kind}`}>
      <h3 className="flex items-center gap-2 text-body leading-5 font-semibold">
        <Icon aria-hidden className="size-4 shrink-0" />
        {word}
        <span className="font-normal text-muted-foreground tabular-nums">{tiles.length}</span>
      </h3>
      <ul className={HARBOUR_TILE_GRID}>
        {tiles.map((ship) => (
          <li key={ship.id} className="min-w-0">
            <HarbourTile ship={ship} kind={kind} href={hrefOf?.(ship.id)} link={link} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}
