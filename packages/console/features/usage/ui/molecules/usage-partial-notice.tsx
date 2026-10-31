import { TriangleAlert } from 'lucide-react';

/** Machines the trierarch plugin lists that have no usage in the range, named under the chart (usage design, "States", partial). Nothing when none. */
export function UsagePartialNotice({ machines }: { machines: readonly string[] }) {
  if (machines.length === 0) {
    return null;
  }
  return (
    <p role="status" data-testid="usage-partial" className="flex items-center gap-2 rounded-lg border border-tone-waiting-border bg-tone-waiting-bg px-3 py-2 text-meta text-tone-waiting-fg">
      <TriangleAlert aria-hidden className="size-(--size-icon-sm) shrink-0" />
      <span>
        <b className="font-semibold">{machines.join(', ')}</b> {machines.length === 1 ? 'sends' : 'send'} no usage in this range.
      </span>
    </p>
  );
}
