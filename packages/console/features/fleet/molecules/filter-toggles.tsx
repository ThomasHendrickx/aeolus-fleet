import { Button } from '../../../components/atoms/button';

export interface FilterTogglesProps {
  /** The filter's name, over its chips and as the group's name: "Kind". */
  label: string;
  /** What the chip for nothing picked reads: "All", or "All types". */
  allLabel?: string;
  /** Every value it can pick, with its word, in the order listed. */
  items: Readonly<Record<string, string>>;
  /** The values picked, in the order picked; none is no filter. */
  picked: readonly string[];
  onPickedChange: (picked: string[]) => void;
  /** Segments share the row (Status); chips wrap. */
  layout?: 'segments' | 'chips';
  testId?: string;
}

/**
 * An overview filter that picks several values (#815) in the phone's filter
 * Sheet (canvas, MOverviewFilters): one toggle per value, on when picked,
 * and All, on while nothing is picked, which takes every value out.
 */
export function FilterToggles({ label, allLabel = 'All', items, picked, onPickedChange, layout = 'chips', testId }: FilterTogglesProps) {
  return (
    <div className="flex flex-col gap-2">
      <span aria-hidden className="text-meta font-medium text-muted-foreground">
        {label}
      </span>
      <div role="group" aria-label={label} data-testid={testId} className={layout === 'segments' ? 'flex gap-1.5 [&>*]:flex-1' : 'flex flex-wrap gap-1.5'}>
        <Button
          variant={picked.length === 0 ? 'primary' : 'secondary'}
          size="touch"
          aria-pressed={picked.length === 0}
          onClick={() => {
            onPickedChange([]);
          }}
        >
          {allLabel}
        </Button>
        {Object.entries(items).map(([value, word]) => {
          const isPicked = picked.includes(value);
          return (
            <Button
              key={value}
              variant={isPicked ? 'primary' : 'secondary'}
              size="touch"
              aria-pressed={isPicked}
              onClick={() => {
                onPickedChange(isPicked ? picked.filter((each) => each !== value) : [...picked, value]);
              }}
            >
              {word}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
