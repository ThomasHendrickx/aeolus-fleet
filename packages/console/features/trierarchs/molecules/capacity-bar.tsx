import type { CrewStatus } from '@aeolus-fleet/common';

import { classNames } from '../../../lib/class-names';
import { capacityLine, type Spot } from '../../../lib/machines';

/** Each spot's colour by its session (canvas TrierarchPlugin, Capacity): running ok, crewing and releasing active, restarting waiting, crashed attention. */
const SPOT_TONES: Record<CrewStatus, string> = {
  running: 'bg-tone-ok-fg',
  crewing: 'bg-tone-active-fg',
  releasing: 'bg-tone-active-fg',
  restarting: 'bg-tone-waiting-fg',
  crashed: 'bg-tone-attention-fg',
};

interface CapacityBarProps {
  spots: readonly Spot[];
  /** How many ships the machine crews at most; unknown until it reported. */
  caps: { ships: number } | undefined;
  /** When the capacity is unknown, what to say instead: "Unknown since 10:40". */
  unknownText?: string;
  testId?: string;
}

/**
 * A machine's capacity (canvas TrierarchPlugin, Capacity): one segment per
 * spot, coloured by the session in it, free ones outlined, then the words, so
 * it reads without colour. Each segment names its ship and status.
 */
export function CapacityBar({ spots, caps, unknownText = 'Unknown', testId }: CapacityBarProps) {
  const line = capacityLine(spots, caps);
  if (caps === undefined || line === undefined) {
    return (
      <span data-testid={testId} className="text-meta text-muted-foreground">
        {unknownText}
      </span>
    );
  }
  const free = Math.max(0, caps.ships - spots.length);
  return (
    <span role="img" aria-label={line} data-testid={testId} className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span aria-hidden className="inline-flex shrink-0 gap-0.5">
        {spots.map((spot, index) => (
          <span key={spot.shipId} title={`Spot ${String(index + 1)}: ${spot.name}, ${spot.status}`} className={classNames('h-2 w-3 rounded-xs', SPOT_TONES[spot.status])} />
        ))}
        {Array.from({ length: free }, (_unused, index) => (
          <span key={`free-${String(index)}`} title={`Spot ${String(spots.length + index + 1)}: vacant`} className="h-2 w-3 rounded-xs border border-input" />
        ))}
      </span>
      <span className="text-meta tabular-nums">{line}</span>
    </span>
  );
}
