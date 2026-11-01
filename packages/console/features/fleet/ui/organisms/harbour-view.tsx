import { Network, Plug, SquareTerminal, Users, type LucideIcon } from 'lucide-react';

import { InlineError } from '../../../../components/molecules/inline-error';
import { Skeleton } from '../../../../components/atoms/skeleton';
import type { Harbour, HarbourGroupKind } from '../../services/harbour';
import { HarbourNumbers } from '../molecules/harbour-numbers';
import { HarbourTile } from '../molecules/harbour-tile';

const GROUP_LOOK: Record<HarbourGroupKind, { word: string; Icon: LucideIcon }> = {
  people: { word: 'People', Icon: Users },
  agents: { word: 'Agents', Icon: SquareTerminal },
  plugins: { word: 'Plugins', Icon: Plug },
  gateway: { word: 'Through the gateway', Icon: Network },
};

const TILES = 'grid grid-cols-[repeat(auto-fill,132px)] gap-2 max-sm:grid-cols-3 max-sm:gap-1.5';

/** The shape of a group that is coming, while the fleet is read. */
const LOADING_TILES = ['first', 'second', 'third', 'fourth'] as const;

/**
 * Harbour (docs/design/fleet-overview): the numbers on top, then one tile per
 * ship grouped by kind (People, Agents, Plugins, Through the gateway), each
 * group with how many ships it holds, alerts first, then waiting, working and
 * idle. Tiles three across on phone. While the fleet is read, the shape that
 * is coming; when the read fails, what went wrong and a retry.
 */
export function HarbourView({ harbour, state, onRetry }: { harbour: Harbour | undefined; state: 'loading' | 'error' | 'ready'; onRetry: () => void }) {
  return (
    <section aria-label="Harbour" className="flex flex-col gap-3.5" data-testid="harbour">
      <HarbourNumbers counts={state === 'ready' ? harbour?.counts : undefined} />
      {state === 'error' ? <InlineError variant="section" title="Couldn’t read the fleet" onRetry={onRetry} /> : null}
      {state === 'loading' ? (
        <div className={TILES}>
          {LOADING_TILES.map((key) => (
            <Skeleton key={key} className="h-18 rounded-lg max-sm:h-15.5" />
          ))}
        </div>
      ) : null}
      {state === 'ready'
        ? harbour?.groups.map(({ kind, tiles }) => {
            const { word, Icon } = GROUP_LOOK[kind];
            return (
              <div key={kind} className="flex flex-col gap-2" data-testid={`harbour-group-${kind}`}>
                <h2 className="flex items-center gap-2 text-body font-semibold">
                  <Icon aria-hidden className="size-4" />
                  {word}
                  <span className="font-normal text-muted-foreground tabular-nums">{tiles.length}</span>
                </h2>
                <div className={TILES}>
                  {tiles.map((tile) => (
                    <HarbourTile key={tile.id} tile={tile} />
                  ))}
                </div>
              </div>
            );
          })
        : null}
    </section>
  );
}
