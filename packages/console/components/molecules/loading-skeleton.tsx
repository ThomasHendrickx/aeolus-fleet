import { classNames } from '../../lib/class-names';
import { Skeleton } from '../atoms/skeleton';

const DEFAULT_ROWS = 4;
const METRIC_CARDS = 4;

interface LoadingSkeletonProps {
  variant: 'table' | 'cards' | 'detail' | 'list';
  /** Rows in a table or list. */
  rows?: number;
  /** What is loading, for assistive technology: "Loading the fleet". */
  label?: string;
  className?: string;
}

function rowKeys(count: number): string[] {
  return Array.from({ length: count }, (_, row) => `row-${String(row)}`);
}

/**
 * Loading in the shape of the real content (docs/design/png/LoadingSkeleton.png):
 * the page frame stays, skeletons stand in for the table, metric cards, detail
 * header or phone list. No spinners. The page switches to the page InlineError
 * after 10 s without data; that timing belongs to the page.
 */
export function LoadingSkeleton({ variant, rows = DEFAULT_ROWS, label = 'Loading', className }: LoadingSkeletonProps) {
  return (
    <div
      role="status"
      data-slot="loading-skeleton"
      data-variant={variant}
      className={classNames('w-full', className)}
    >
      <span className="sr-only">{label}</span>
      {variant === 'table' ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="h-(--size-row-header) border-b border-border bg-muted" />
          {rowKeys(rows).map((key) => (
            <div
              key={key}
              className="flex h-(--size-row) items-center gap-8 border-b border-border px-4 last:border-0"
            >
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-2.5 w-28" />
            </div>
          ))}
        </div>
      ) : null}
      {variant === 'cards' ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {rowKeys(METRIC_CARDS).map((key) => (
            <div key={key} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-6 w-10" />
              <Skeleton className="h-2.5 w-28" />
            </div>
          ))}
        </div>
      ) : null}
      {variant === 'detail' ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-48" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : null}
      {variant === 'list' ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {rowKeys(rows).map((key) => (
            <div key={key} className="flex flex-col gap-2.5 border-b border-border px-3.5 py-3 last:border-0">
              <div className="flex justify-between">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-2.5 w-44" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
