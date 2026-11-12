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

/**
 * The border: the state's border colour, mixed toward its hover colour by
 * the hover amount, in the colour space a transition between the two tokens
 * used: sRGB for the hex tones, Oklab for Idle's oklch.
 */
const BORDER_HEX = 'border-[color-mix(in_srgb,var(--harbour-tile-border),var(--harbour-tile-hover-border)_calc(var(--harbour-tile-hover)*100%))]';
const BORDER_OKLCH = 'border-[color-mix(in_oklab,var(--harbour-tile-border),var(--harbour-tile-hover-border)_calc(var(--harbour-tile-hover)*100%))]';

/** A tile is filled in its state's tone (docs/design/state-colours); Idle stays plain, so colour marks only what is going on. */
const TILE_TONES: Record<HarbourState, string> = {
  alert: `${BORDER_HEX} [--harbour-tile-border:var(--tone-attention-border)] bg-tone-attention-bg text-tone-attention-fg`,
  awaitingCrew: `${BORDER_HEX} [--harbour-tile-border:var(--tone-waiting-border)] bg-tone-waiting-bg text-tone-waiting-fg`,
  blocked: `${BORDER_HEX} [--harbour-tile-border:var(--tone-blocked-border)] bg-tone-blocked-bg text-tone-blocked-fg`,
  working: `${BORDER_HEX} [--harbour-tile-border:var(--tone-active-border)] bg-tone-active-bg text-tone-active-fg`,
  idle: `${BORDER_OKLCH} [--harbour-tile-border:var(--border)] bg-card text-muted-foreground`,
};

/** On a link, hover and press give the border the state's colour. */
const LINK_TONES: Record<HarbourState, string> = {
  alert: '[--harbour-tile-hover-border:var(--tone-attention-fg)]',
  awaitingCrew: '[--harbour-tile-hover-border:var(--tone-waiting-fg)]',
  blocked: '[--harbour-tile-hover-border:var(--tone-blocked-fg)]',
  working: '[--harbour-tile-hover-border:var(--tone-active-fg)]',
  idle: '[--harbour-tile-hover-border:var(--muted-foreground)]',
};

const TILE = 'relative grid h-full min-h-28 min-w-0 grid-rows-[auto_1fr_auto] gap-1 overflow-hidden rounded-md border px-3 py-2.5 no-underline motion-reduce:transition-none';

/**
 * A new state's colours settle over 180 ms rather than flash; its word, icon
 * and band change at once (docs/design/working-band). Reduced motion: at once.
 */
const SETTLE = 'transition-colors duration-180 ease-[ease-out] motion-reduce:transition-none';

/** A tile that is not a link settles its background, text and border. */
const PLAIN = '[transition-property:background-color,color,--harbour-tile-border] duration-180 ease-[ease-out]';

/**
 * A link lifts a little on hover with a soft shadow and its border takes the
 * state's colour, on the control timing; pressed, it sits down again. Its
 * state colours settle as a plain tile's do, under the pointer too. Reduced
 * motion: nothing moves.
 */
const LINK =
  'group cursor-pointer [transition:background-color_180ms_ease-out,color_180ms_ease-out,--harbour-tile-border_180ms_ease-out,--harbour-tile-hover-border_180ms_ease-out,--harbour-tile-hover_var(--duration-fast)_var(--default-transition-timing-function),box-shadow_var(--duration-fast)_var(--default-transition-timing-function),transform_var(--duration-fast)_var(--default-transition-timing-function)] outline-none hover:-translate-y-px hover:shadow-[0_2px_8px_-2px_color-mix(in_oklch,var(--foreground)_18%,transparent)] hover:[--harbour-tile-hover:1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-0 active:shadow-none active:[--harbour-tile-hover:1] motion-reduce:hover:translate-y-0';

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
 * reduced motion; a new state's colours settle without moving the tile. The title holds "name: note" for the note cut short.
 */
export function HarbourTile({ ship, kind, href, link, now }: HarbourTileProps) {
  const { name, state, note } = ship;
  const { kindWord, KindIcon } = HARBOUR_GROUP_LOOK[kind];
  const isLink = href !== undefined;
  const content = (
    <>
      <span className="flex min-w-0 items-start gap-2 pr-4.5">
        <span data-testid="harbour-tile-kind" title={kindWord} className={classNames('inline-flex size-5.5 shrink-0 items-center justify-center rounded-md border bg-card/70', SETTLE, state === 'idle' ? 'border-border' : 'border-current/25')}>
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
        <ShipState state={state} size="caption" className={SETTLE} />
        <span data-testid="harbour-tile-age" className="text-caption whitespace-nowrap text-muted-foreground">
          {lastActivityWordsOf(ship.lastActivityAt, now)}
        </span>
      </span>
      {state === 'working' ? (
        <i
          data-testid="harbour-tile-live"
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 animate-live-band bg-[linear-gradient(90deg,transparent,var(--live-band),transparent)] bg-size-[40%_100%] bg-no-repeat opacity-45 motion-reduce:animate-none motion-reduce:bg-live-band motion-reduce:bg-none"
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
      className: classNames(TILE, TILE_TONES[state], isLink ? classNames(LINK, LINK_TONES[state]) : PLAIN),
      ...(isLink ? { href } : {}),
      children: content,
    },
  });
}
