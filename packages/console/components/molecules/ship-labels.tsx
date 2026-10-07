'use client';

import { ChevronUp } from 'lucide-react';
import { useState } from 'react';

import type { LabelChip as LabelChipData } from '../../lib/labels';
import { LabelChip } from './label-chip';

interface ShipLabelsProps {
  /** The ship's labels as chips, yours first. */
  chips: readonly LabelChipData[];
}

/** How many chips show before the rest fold into "+n" (canvas Labels, LbShipFew). */
const SHOWN = 2;

/** The chips in groups: yours first, then each other owner's after "by <owner>". */
function groupsOf(chips: readonly LabelChipData[]): { owner: string | null; chips: LabelChipData[] }[] {
  const groups: { owner: string | null; chips: LabelChipData[] }[] = [];
  for (const chip of chips) {
    const owner = chip.mark === 'none' ? null : chip.ownerName;
    const group = groups.find((each) => each.owner === owner);
    if (group === undefined) {
      groups.push({ owner, chips: [chip] });
    } else {
      group.chips.push(chip);
    }
  }
  return groups;
}

/**
 * A ship's labels on its page (canvas Labels, LbShipFew, LbShipExpanded,
 * LbShipNone): the first two, then "+n", which shows them all, others' after
 * "by <owner>", and Show fewer. "No labels" without any. Read-only.
 */
export function ShipLabels({ chips }: ShipLabelsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (chips.length === 0) {
    return <span className="text-meta text-muted-foreground">No labels</span>;
  }
  const isFolded = !isExpanded && chips.length > SHOWN;
  if (isFolded) {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {chips.slice(0, SHOWN).map((chip) => (
          <LabelChip key={chip.valueId} chip={chip} testId="ship-label" />
        ))}
        <button
          type="button"
          aria-label={`Show all ${String(chips.length)} labels`}
          data-testid="ship-labels-more"
          className="inline-flex h-5.5 items-center rounded-sm bg-secondary px-1.5 text-caption font-medium tabular-nums hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => {
            setIsExpanded(true);
          }}
        >
          +{chips.length - SHOWN}
        </button>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      {groupsOf(chips).map((group) => (
        <span key={group.owner ?? ''} className="inline-flex flex-wrap items-center gap-1.5">
          {group.owner === null ? null : <span className="text-meta text-muted-foreground">by {group.owner}</span>}
          {group.chips.map((chip) => (
            <LabelChip key={chip.valueId} chip={chip} testId="ship-label" />
          ))}
        </span>
      ))}
      {chips.length > SHOWN ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-sm px-1 text-meta hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon-sm)"
          onClick={() => {
            setIsExpanded(false);
          }}
        >
          <ChevronUp aria-hidden />
          Show fewer
        </button>
      ) : null}
    </span>
  );
}
