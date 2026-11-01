import Link from 'next/link';

import { classNames } from '@aeolus-fleet/ui';
import type { HarbourTile as Tile } from '../../services/harbour';
import { HARBOUR_STATE_LOOK } from './harbour-state';

/**
 * One ship on Harbour (docs/design/fleet-overview): its name and its state's
 * icon and word in the tone, the tile filled in the tone; an idle tile stays
 * plain. What the ship is doing (its report's note) is the tile's title,
 * "name: note", or "name: state" before it reports, as the mockup's markup
 * has it. A tap or click opens the ship's page (Thomas). On phone the
 * tile's sides are narrower, so a name such as builder-gateway shows whole
 * three tiles across.
 */
export function HarbourTile({ tile }: { tile: Tile }) {
  const { word, Icon, text, fill } = HARBOUR_STATE_LOOK[tile.state];
  return (
    <Link
      href={`/ships/${tile.id}`}
      data-testid="harbour-tile"
      title={`${tile.name}: ${tile.note ?? word}`}
      className={classNames(
        'flex h-18 min-w-0 flex-col justify-between rounded-lg border px-2.5 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:h-15.5 max-sm:px-1 max-sm:py-1.5',
        fill,
      )}
    >
      <span className="truncate text-meta font-semibold text-foreground">{tile.name}</span>
      <span className={classNames('inline-flex items-center gap-1 text-caption font-medium', text)}>
        <Icon aria-hidden className="size-3" />
        {word}
      </span>
    </Link>
  );
}
