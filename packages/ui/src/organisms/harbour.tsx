'use client';

import type { ShipId } from '@aeolus-fleet/common';
import type { useRender } from '@base-ui/react/use-render';
import { CircleAlert, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../atoms/button.js';
import { classNames } from '../class-names.js';
import { HarbourGroup } from '../molecules/harbour-group.js';
import { HarbourNumbers, type HarbourCounts } from '../molecules/harbour-numbers.js';
import type { HarbourGroupKind } from '../molecules/harbour-state.js';
import type { HarbourTileShip } from '../molecules/harbour-tile.js';

/** One of Harbour's groups as the app hands it: its kind and its tiles, in the order to show. */
export interface HarbourGroupShips {
  kind: HarbourGroupKind;
  tiles: readonly HarbourTileShip[];
}

export interface HarbourProps {
  /** The numbers; undefined draws their loading shape. */
  counts: HarbourCounts | undefined;
  /** The groups with a ship, in order; undefined draws the loading shape. */
  groups: readonly HarbourGroupShips[] | undefined;
  /** The time each tile's last activity is measured from. */
  now: Date;
  /** Each ship's page; none draws tiles that are not links. */
  hrefOf?: (shipId: ShipId) => string;
  /** The app's link for the tiles, such as Next.js's Link, through Base UI's render prop. */
  link?: useRender.RenderProp;
  /** Between the numbers and the groups: the console's filter bar; Bridge passes none. */
  between?: ReactNode;
  /** Stands in for the groups when there are none: no match, argo alone. */
  empty?: ReactNode;
  state: 'ready' | 'loading' | 'error';
  /** The failed read's technical reason, in mono. */
  errorDetail?: string;
  onRetry: () => void;
  /** A new result is coming: the groups shown are the previous one, dimmed. */
  isUpdating?: boolean;
}

/** The shape of the tiles that are coming, while the fleet is read. */
const LOADING_TILES = ['first', 'second', 'third', 'fourth'] as const;

function HarbourLoading() {
  return (
    <div className="flex flex-col gap-2" data-testid="harbour-loading" aria-hidden>
      <span className="h-4 w-30 animate-pulse rounded-sm bg-secondary [animation-duration:var(--duration-pulse)] motion-reduce:animate-none" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2 @max-[24rem]:grid-cols-2">
        {LOADING_TILES.map((key) => (
          <span key={key} className="min-h-28 animate-pulse rounded-md bg-secondary [animation-duration:var(--duration-pulse)] motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}

function HarbourError({ detail, onRetry }: { detail: string | undefined; onRetry: () => void }) {
  return (
    <div role="alert" data-testid="harbour-error" className="flex items-start gap-2.5 rounded-lg border border-tone-attention-border bg-tone-attention-bg px-3 py-2.5 text-tone-attention-fg">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-meta font-semibold text-foreground">Couldn’t read the fleet</p>
        <p className="text-meta text-foreground">
          Nothing changed. The page tries again by itself
          {detail === undefined ? '.' : '; '}
          {detail === undefined ? null : <code className="font-mono text-code wrap-anywhere">{detail}</code>}
        </p>
      </div>
      <Button size="xs" icon={<RotateCw aria-hidden />} onClick={onRetry} data-testid="harbour-retry">
        Try again
      </Button>
    </div>
  );
}

/**
 * Harbour (docs/design/fleet-overview), the fleet overview the console and
 * Bridge share: the numbers on top, then what the app puts between (the
 * console's filter bar), then one tile per ship grouped People, Agents,
 * Plugins and Through the gateway. Props only: each app reads the fleet its
 * own way. It lays itself out by its own width, not the window's (a
 * container query), so the same part fits the console's page and Bridge's
 * column. While the fleet is read, the shape that is coming; when the read
 * fails, what went wrong and Try again.
 */
export function Harbour({ counts, groups, now, hrefOf, link, between, empty, state, errorDetail, onRetry, isUpdating = false }: HarbourProps) {
  const body =
    state === 'error' ? (
      <HarbourError detail={errorDetail} onRetry={onRetry} />
    ) : state === 'loading' || groups === undefined ? (
      <HarbourLoading />
    ) : groups.length === 0 ? (
      empty
    ) : (
      <div className={classNames('flex flex-col gap-3.5 transition-opacity duration-(--duration-fast) motion-reduce:transition-none', isUpdating ? 'opacity-55' : undefined)} aria-busy={isUpdating} data-testid="harbour-groups">
        {groups.map(({ kind, tiles }) => (
          <HarbourGroup key={kind} kind={kind} tiles={tiles} hrefOf={hrefOf} link={link} now={now} />
        ))}
      </div>
    );
  return (
    <section aria-label="Harbour" className="@container flex min-w-0 flex-col gap-3.5" data-testid="harbour">
      {/* A failed first read has no numbers to show: the error says so, rather than a shape that never comes. */}
      {state === 'error' && counts === undefined ? null : <HarbourNumbers counts={state === 'loading' ? undefined : counts} />}
      {between}
      {body}
    </section>
  );
}
