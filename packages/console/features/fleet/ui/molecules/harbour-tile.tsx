'use client';

import Link from 'next/link';

import { classNames } from '@aeolus-fleet/ui';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '../../../../components/atoms/popover';
import type { HarbourTile as Tile } from '../../services/harbour';
import { HARBOUR_STATE_LOOK } from './harbour-state';

/**
 * One ship on Harbour (docs/design/fleet-overview): its name, truncated when
 * long, and its state's icon and word in the tone, the tile filled in the
 * tone; an idle tile stays plain. What the ship is doing (its report's note)
 * opens on hover and on tap, with the way to the ship.
 */
export function HarbourTile({ tile }: { tile: Tile }) {
  const { word, Icon, text, fill } = HARBOUR_STATE_LOOK[tile.state];
  const doing = tile.note ?? 'No report yet';
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        data-testid="harbour-tile"
        data-state-word={word}
        aria-label={`${tile.name}: ${word}`}
        className={classNames(
          'flex h-18 min-w-0 cursor-pointer flex-col justify-between rounded-lg border px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:h-15.5 max-sm:px-2 max-sm:py-1.5',
          fill,
        )}
      >
        <span className="truncate text-meta font-semibold text-foreground">{tile.name}</span>
        <span className={classNames('inline-flex items-center gap-1 text-caption font-medium', text)}>
          <Icon aria-hidden className="size-3" />
          {word}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={8} className="flex max-w-72 flex-col gap-1 px-3 py-2" data-testid="harbour-tile-doing">
        <PopoverTitle className="truncate text-meta font-semibold">{tile.name}</PopoverTitle>
        <PopoverDescription className={classNames('text-meta', tile.note === null ? 'text-muted-foreground' : 'text-foreground')}>{doing}</PopoverDescription>
        <Link href={`/ships/${tile.id}`} className="text-meta font-medium text-primary hover:underline" data-testid="harbour-tile-open">
          Open ship
        </Link>
      </PopoverContent>
    </Popover>
  );
}
