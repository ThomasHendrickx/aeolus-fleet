import { Boxes, Ship, ShipWheel, X } from 'lucide-react';

import { classNames } from '../../lib/class-names';
import type { LabelChip as LabelChipData, OwnerMark } from '../../lib/labels';

interface LabelChipProps {
  chip: Pick<LabelChipData, 'key' | 'value' | 'mark' | 'ownerName'>;
  /** Takes the value out of a filter: the chip then ends in an × button. */
  onRemove?: () => void;
  testId?: string;
  className?: string;
}

const MARKS: Record<Exclude<OwnerMark, 'none'>, typeof Ship> = { 'trierarch-plugin': ShipWheel, squadrons: Boxes, ship: Ship };

/**
 * One label value a ship carries (canvas Labels, LabelChip): `key=value` in
 * mono, the key muted, with its owner's mark before it unless the label is
 * yours (Q10). Its title names the owner. In a filter it ends in an × that
 * takes it out.
 */
export function LabelChip({ chip, onRemove, testId, className }: LabelChipProps) {
  const Mark = chip.mark === 'none' ? null : MARKS[chip.mark];
  const text = `${chip.key}=${chip.value}`;
  const owner = chip.mark === 'none' ? 'you' : chip.ownerName;
  return (
    <span
      data-slot="label-chip"
      data-testid={testId}
      title={`${text}, by ${owner}`}
      className={classNames(
        'inline-flex h-5.5 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-sm border border-border bg-secondary px-1.5 font-mono text-id whitespace-nowrap text-foreground [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        className,
      )}
    >
      {Mark === null ? null : <Mark aria-hidden />}
      <span className="truncate">
        <span className="text-muted-foreground">{chip.key}=</span>
        <span className="font-medium">{chip.value}</span>
      </span>
      {onRemove === undefined ? null : (
        <button
          type="button"
          aria-label={`Remove ${text}`}
          onClick={onRemove}
          className="-mr-1 ml-0.5 inline-flex size-4 items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X aria-hidden />
        </button>
      )}
    </span>
  );
}
