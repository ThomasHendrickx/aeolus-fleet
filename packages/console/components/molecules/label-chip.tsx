import { Boxes, Ship, ShipWheel, TagX, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { classNames } from '../../lib/class-names';
import { chipTitleOf, type LabelChip as LabelChipData, type ChipMark } from '../../lib/labels';

interface LabelChipProps {
  chip: Pick<LabelChipData, 'key' | 'value' | 'mark' | 'ownerName'>;
  /** Takes the value out of a filter: the chip then ends in an × button. */
  onRemove?: () => void;
  testId?: string;
  className?: string;
  /** What ends the chip when it opens a menu: a chevron. */
  trailing?: ReactNode;
}

const MARKS: Record<Exclude<ChipMark, 'none'>, typeof Ship> = { 'trierarch-plugin': ShipWheel, squadrons: Boxes, ship: Ship, gone: TagX };

/**
 * One label value a ship carries (canvas Labels, LabelChip): `key=value` in
 * mono, the key muted, with its owner's mark before it unless the label is
 * yours (Q10). Its title names the owner, or says the label no longer
 * exists (#523); such a chip has a crossed-out tag and a dashed edge, so it
 * never looks like yours without a hover (#528). The same words are its
 * accessible name, a named group, since many screen readers never read a
 * title (#577). In a filter it ends in an × that takes it out.
 */
export function LabelChip({ chip, onRemove, testId, className, trailing }: LabelChipProps) {
  const Mark = chip.mark === 'none' ? null : MARKS[chip.mark];
  const text = `${chip.key}=${chip.value}`;
  const title = chipTitleOf(chip);
  return (
    <span
      role="group"
      aria-label={title}
      data-slot="label-chip"
      data-testid={testId}
      title={title}
      className={classNames(
        'inline-flex h-5.5 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-sm border border-border bg-secondary px-1.5 font-mono text-id whitespace-nowrap text-foreground [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        chip.mark === 'gone' ? 'border-dashed' : null,
        className,
      )}
    >
      {Mark === null ? null : <Mark aria-hidden />}
      <span className="truncate">
        <span className="text-muted-foreground">{chip.key}=</span>
        <span className="font-medium">{chip.value}</span>
      </span>
      {trailing}
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
