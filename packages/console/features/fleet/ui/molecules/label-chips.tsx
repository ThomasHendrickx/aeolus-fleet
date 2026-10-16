import Link from 'next/link';

import { chipTitleOf, rowChips, type LabelChip as LabelChipData } from '../../../../lib/labels';
import { LabelChip } from '../../../../components/molecules/label-chip';

interface LabelChipsProps {
  chips: readonly LabelChipData[];
  /** How much fits, in characters of `key=value`; zero reserves the cell for membership and folds all labels into "+n". */
  width: number;
  testId?: string;
  /** The ship page keeps every assigned label available without hover. */
  href?: string;
}

/**
 * A ship's labels on one line (canvas Labels, Q2): as many chips as fit,
 * then "+n" for the rest, whose names its title lists. Nothing without labels.
 */
export function LabelChips({ chips, width, testId, href }: LabelChipsProps) {
  if (chips.length === 0) {
    return null;
  }
  const { shown, folded } = width === 0 ? { shown: [], folded: chips } : rowChips(chips, width);
  return (
    <span data-testid={testId} className="flex min-w-0 items-center gap-1 overflow-hidden">
      {shown.map((chip, index) => (
        // Only the first chip, which always shows, gives way to a narrow column.
        <LabelChip key={chip.valueId} chip={chip} className={index === 0 ? 'min-w-0 shrink' : undefined} />
      ))}
      {folded.length === 0 ? null : href === undefined ? (
        <span title={folded.map(chipTitleOf).join('; ')} className="inline-flex h-5.5 shrink-0 items-center rounded-sm bg-secondary px-1.5 text-caption font-medium text-foreground tabular-nums">
          +{folded.length}<span className="sr-only"> more labels</span>
        </span>
      ) : (
        <Link href={href} title={folded.map(chipTitleOf).join('; ')} aria-label={`View ${folded.length} more labels`} className="inline-flex h-5.5 shrink-0 items-center rounded-sm bg-secondary px-1.5 text-caption font-medium text-foreground tabular-nums hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          +{folded.length}
        </Link>
      )}
    </span>
  );
}
