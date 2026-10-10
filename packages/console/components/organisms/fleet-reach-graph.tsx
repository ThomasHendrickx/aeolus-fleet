import type { ShipId } from '@aeolus-fleet/common';
import { Ban, Check, Crosshair } from 'lucide-react';

import { classNames } from '../../lib/class-names';
import { graphNodesOf, reachSummaryOf, type GraphNode, type GraphShip, type ReachMark } from '../../lib/reach-graph';
import { Button } from '../atoms/button';
import { InlineError } from '../molecules/inline-error';

export interface FleetReachGraphProps {
  /** The fleet's ships that sail, argo first (lib/reach-graph.ts). */
  ships: readonly GraphShip[];
  /** The ship argo picked, if any. */
  pickedShipId: ShipId | undefined;
  /** The ships the picked ship reaches, as the fleet explained it; undefined while it is not known. */
  reachableShipIds: readonly ShipId[] | undefined;
  /** Why the fleet could not explain the picked ship's reach. */
  reachError?: string;
  onPick: (shipId: ShipId | undefined) => void;
  onRetry?: () => void;
}

const MARK_WORD: Record<Exclude<ReachMark, 'none'>, string> = { picked: 'picked', reached: 'may be messaged', unreached: 'out of reach' };

/**
 * The fleet graph in reach mode (design point 12 on #260; decision 0034):
 * every ship that sails on a circle. Picking a ship highlights the ships it
 * may message, with a line to each, and dims the others; picking it again
 * lets go. Each mark has its icon and its word, and the sentence under the
 * graph says the same, so nothing rests on look alone. On a phone the ships
 * wrap as a list, without lines. Argo's only: the page shows it to argo.
 */
export function FleetReachGraph({ ships, pickedShipId, reachableShipIds, reachError, onPick, onRetry }: FleetReachGraphProps) {
  const reach = pickedShipId === undefined ? undefined : { pickedShipId, reachableShipIds: reachError === undefined ? reachableShipIds : undefined };
  const nodes = graphNodesOf(ships, reach);
  const picked = nodes.find((node) => node.mark === 'picked');
  const reached = nodes.filter((node) => node.mark === 'reached');

  return (
    <section aria-labelledby="network-reach" data-testid="network-reach" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="network-reach" className="text-body font-semibold">
        Reach
      </h2>
      <p className="text-meta text-muted-foreground">The fleet as it stands now: pick a ship to see which ships the rules let it message. Argo reaches every ship, and every ship reaches argo.</p>
      <div className="relative flex flex-wrap gap-2 md:mx-auto md:block md:aspect-square md:w-full md:max-w-xl" data-testid="network-reach-graph">
        {picked === undefined ? null : (
          <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 hidden size-full md:block">
            {reached.map((node) => (
              <line
                key={node.ship.id}
                x1={picked.x}
                y1={picked.y}
                x2={node.x}
                y2={node.y}
                vectorEffect="non-scaling-stroke"
                className="stroke-muted-foreground"
                strokeWidth={1.5}
              />
            ))}
          </svg>
        )}
        {nodes.map((node) => (
          <ShipNode
            key={node.ship.id}
            node={node}
            onPick={() => {
              onPick(node.mark === 'picked' ? undefined : node.ship.id);
            }}
          />
        ))}
      </div>
      {reachError === undefined ? (
        <p className="text-body" role="status" data-testid="network-reach-summary">
          {reachSummaryOf(nodes)}
        </p>
      ) : (
        <InlineError title="Couldn’t explain this ship’s reach" description={reachError} onRetry={onRetry} />
      )}
    </section>
  );
}

function ShipNode({ node, onPick }: { node: GraphNode; onPick: () => void }) {
  const { ship, mark } = node;
  return (
    <Button
      size="sm"
      variant="secondary"
      aria-pressed={mark === 'picked'}
      aria-label={mark === 'none' ? ship.name : `${ship.name}, ${MARK_WORD[mark]}`}
      icon={iconOf(mark)}
      data-testid="network-reach-ship"
      data-mark={mark}
      style={{ left: `${String(node.x)}%`, top: `${String(node.y)}%` }}
      className={classNames(
        'md:absolute md:-translate-x-1/2 md:-translate-y-1/2',
        mark === 'picked' && 'bg-accent ring-2 ring-ring',
        mark === 'unreached' && 'opacity-45',
      )}
      onClick={onPick}
    >
      {ship.name}
    </Button>
  );
}

function iconOf(mark: ReachMark) {
  switch (mark) {
    case 'picked':
      return <Crosshair aria-hidden />;
    case 'reached':
      return <Check aria-hidden />;
    case 'unreached':
      return <Ban aria-hidden />;
    case 'none':
      return undefined;
  }
}
