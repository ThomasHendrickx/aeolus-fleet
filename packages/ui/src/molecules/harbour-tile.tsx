'use client';

import type { HarbourOutput } from '@aeolus-fleet/common';
import type { HarbourState } from '@aeolus-fleet/common/rules';
import { useRender } from '@base-ui/react/use-render';
import { ArrowUpRight } from 'lucide-react';

import { ShipState, shipStateWordOf } from '../atoms/ship-state.js';
import { classNames } from '../class-names.js';
import { lastActivityWordsOf } from './harbour-activity.js';
import { HARBOUR_GROUP_LOOK, type HarbourGroupKind } from './harbour-state.js';

/** A ship as its tile shows it: `fleet.harbour`'s tile, its group saying its kind. */
export type HarbourTileShip = Pick<HarbourOutput['items'][number], 'id' | 'name' | 'state' | 'note' | 'lastActivityAt'>;

/** A tile is filled in its state's tone (docs/design/state-colours); Idle stays plain, so colour marks only what is going on. */
const TILE_TONES: Record<HarbourState, string> = {
  alert: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
  awaitingCrew: 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg',
  blocked: 'border-tone-blocked-border bg-tone-blocked-bg text-tone-blocked-fg',
  working: 'border-tone-active-border bg-tone-active-bg text-tone-active-fg',
  idle: 'border-border bg-card text-muted-foreground',
};

/** On a link, hover and press give the border the state's colour. */
const LINK_TONES: Record<HarbourState, string> = {
  alert: 'hover:border-tone-attention-fg active:border-tone-attention-fg',
  awaitingCrew: 'hover:border-tone-waiting-fg active:border-tone-waiting-fg',
  blocked: 'hover:border-tone-blocked-fg active:border-tone-blocked-fg',
  working: 'hover:border-tone-active-fg active:border-tone-active-fg',
  idle: 'hover:border-muted-foreground active:border-muted-foreground',
};

const TILE = 'relative grid h-full min-h-28 min-w-0 grid-rows-[auto_1fr_auto] gap-1 overflow-hidden rounded-md border px-3 py-2.5 no-underline';

/** A link lifts a little on hover with a soft shadow; pressed, it sits down again. Reduced motion: nothing moves. */
const LINK =
  'group cursor-pointer transition-[border-color,box-shadow,transform] duration-(--duration-fast) outline-none hover:-translate-y-px hover:shadow-[0_2px_8px_-2px_color-mix(in_oklch,var(--foreground)_18%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-0 active:shadow-none motion-reduce:transition-none motion-reduce:hover:translate-y-0';

export interface HarbourTileProps {
  ship: HarbourTileShip;
  /** The group the tile sits in: its kind icon. */
  kind: HarbourGroupKind;
  /** The ship's page; none draws a tile that is not a link. */
  href?: string;
  /** The app's link, such as Next.js's Link, through Base UI's render prop; a plain anchor without one. */
  link?: useRender.RenderProp;
  /** The time the last activity is measured from. */
  now: Date;
}

/**
 * One ship on Harbour (docs/design/fleet-overview, "The tile"), the same in
 * the console and Bridge: its kind, its whole name, what it is doing (its
 * report's note, two lines), its state and when it last did something. With
 * an href it opens the ship's page, the arrow showing on hover and focus. A
 * working ship's tile carries the live band in Sea, which stands still under
 * reduced motion. The title holds "name: note" for the note cut short.
 */
export function HarbourTile({ ship, kind, href, link, now }: HarbourTileProps) {
  const { name, state, note } = ship;
  const { kindWord, KindIcon } = HARBOUR_GROUP_LOOK[kind];
  const isLink = href !== undefined;
  const content = (
    <>
      <span className="flex min-w-0 items-start gap-2 pr-4.5">
        <span data-testid="harbour-tile-kind" title={kindWord} className={classNames('inline-flex size-5.5 shrink-0 items-center justify-center rounded-md border bg-card/70', state === 'idle' ? 'border-border' : 'border-current/25')}>
          <KindIcon aria-hidden className="size-3.25" />
        </span>
        <span className="min-w-0 pt-0.5 text-meta leading-4.5 font-semibold wrap-anywhere text-foreground">{name}</span>
      </span>
      {isLink ? (
        <span className="absolute top-2.25 right-2.25 inline-flex text-muted-foreground opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">
          <ArrowUpRight aria-hidden className="size-3.5" />
        </span>
      ) : null}
      <span className="line-clamp-2 text-caption leading-4 text-muted-foreground">{note}</span>
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <ShipState state={state} size="caption" />
        <span data-testid="harbour-tile-age" className="text-caption whitespace-nowrap text-muted-foreground">
          {lastActivityWordsOf(ship.lastActivityAt, now)}
        </span>
      </span>
      {state === 'working' ? (
        <i
          data-testid="harbour-tile-live"
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 animate-live-band bg-[linear-gradient(90deg,transparent,var(--live-band),transparent)] bg-size-[40%_100%] bg-no-repeat opacity-70 motion-reduce:animate-none motion-reduce:bg-live-band motion-reduce:bg-none motion-reduce:opacity-35"
        />
      ) : null}
    </>
  );
  return useRender({
    defaultTagName: isLink ? 'a' : 'div',
    render: isLink ? link : undefined,
    props: {
      'data-testid': 'harbour-tile',
      'data-state': state,
      title: `${name}: ${note ?? shipStateWordOf(state)}`,
      className: classNames(TILE, TILE_TONES[state], isLink ? classNames(LINK, LINK_TONES[state]) : undefined),
      ...(isLink ? { href } : {}),
      children: content,
    },
  });
}
