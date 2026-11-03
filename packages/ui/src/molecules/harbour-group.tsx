'use client';

import type { ShipId } from '@aeolus-fleet/common';
import type { useRender } from '@base-ui/react/use-render';

import { HARBOUR_GROUP_LOOK, type HarbourGroupKind } from './harbour-state.js';
import { HarbourTile, type HarbourTileShip } from './harbour-tile.js';

/**
 * The tiles' columns, by Harbour's own width (a container query on Harbour,
 * docs/design/fleet-overview): as many tiles of at least 14rem as fit (four at
 * the console's 1440, seven at 1920, three in Bridge's column at 1920, one
 * in Bridge's column at 1440), two a row on a phone, under 24rem.
 */
const TILE_COLUMNS = 'grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] @max-[24rem]:grid-cols-2';

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
      <ul className={`grid gap-2 ${TILE_COLUMNS}`}>
        {tiles.map((ship) => (
          <li key={ship.id} className="min-w-0">
            <HarbourTile ship={ship} kind={kind} href={hrefOf?.(ship.id)} link={link} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}
