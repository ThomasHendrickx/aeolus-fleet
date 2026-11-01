'use client';

import { Button } from '@aeolus-fleet/ui';

import { Skeleton } from '../../../../components/atoms/skeleton';
import { EmptyState } from '../../../../components/molecules/empty-state';
import { InlineError } from '../../../../components/molecules/inline-error';
import type { TimeFormat, UsageChart, UsageTotals } from '../../services/usage-chart';
import { tokensWords, usdWords } from '../../services/usage-format';
import { usageNotesOf } from '../../services/usage-notes';
import type { UsageMeasure, UsageSplit } from '../../services/usage-state';
import { UsageLegend } from '../molecules/usage-legend';
import { UsagePartialNotice } from '../molecules/usage-partial-notice';
import { UsageTotalsBlock } from '../molecules/usage-totals';
import { UsageChart as UsageChartFigure } from './usage-chart';
import { UsageTable } from './usage-table';

export type UsageView = { kind: 'loading' } | { kind: 'cannot-read' } | { kind: 'empty'; hasFilters: boolean } | { kind: 'ready'; chart: UsageChart; totals: UsageTotals };

interface UsagePanelProps {
  view: UsageView;
  /** What the range is, in words: "last 7 days". */
  rangeWords: string;
  measure: UsageMeasure;
  splitBy: UsageSplit;
  format: TimeFormat;
  isTable: boolean;
  onTableChange: (isTable: boolean) => void;
  /** Machines the trierarch plugin lists that send no usage in the range. */
  silentMachines: readonly string[];
  onRetry: () => void;
  onClearFilters: () => void;
}

const SKELETON_COLUMNS = 24;

/** Loading in the shape of the card: the totals, the chart and the legend. */
function LoadingShape() {
  return (
    <div role="status" data-testid="usage-loading" className="flex flex-col gap-4">
      <span className="sr-only">Loading usage</span>
      <div className="flex gap-7">
        <Skeleton className="h-12 w-32" />
        <Skeleton className="h-12 w-32" />
      </div>
      <div className="flex h-60 items-end gap-1">
        {Array.from({ length: SKELETON_COLUMNS }, (_, column) => (
          <Skeleton key={`column-${String(column)}`} className="grow" style={{ height: `${String(25 + ((column * 37) % 70))}%` }} />
        ))}
      </div>
      <div className="flex gap-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-28" />
      </div>
    </div>
  );
}

/**
 * The card under the controls (usage design, "The console"): the totals, one
 * stacked column chart with its legend, the notes, the machines sending no
 * usage and the table view. Loading, empty and cannot read keep the card and
 * say so in its place.
 */
export function UsagePanel({ view, rangeWords, measure, splitBy, format, isTable, onTableChange, silentMachines, onRetry, onClearFilters }: UsagePanelProps) {
  const formatValue = measure === 'tokens' ? tokensWords : usdWords;
  return (
    <section aria-label="Usage" data-testid="usage-panel" className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-border bg-card p-3">
      {view.kind === 'loading' ? <LoadingShape /> : null}
      {view.kind === 'cannot-read' ? (
        <div data-testid="usage-cannot-read">
          <InlineError title="Usage cannot be read now: the trierarch plugin does not answer" description="Nothing was lost. Try again in a moment." onRetry={onRetry} />
        </div>
      ) : null}
      {view.kind === 'empty' ? (
        <div data-testid="usage-empty">
          <EmptyState
            variant={view.hasFilters ? 'no-results' : 'section'}
            title="No usage in this range"
            action={
              view.hasFilters ? (
                <Button size="sm" variant="secondary" onClick={onClearFilters} data-testid="usage-clear-filters">
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : null}
      {view.kind === 'ready' ? (
        <>
          <UsageTotalsBlock totals={view.totals} rangeWords={rangeWords} />
          <UsageChartFigure chart={view.chart} format={format} formatValue={formatValue} />
          <UsageLegend series={view.chart.series} formatValue={formatValue} />
          <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-caption text-muted-foreground" data-testid="usage-notes">
            {usageNotesOf({ grain: format.grain, measure, splitBy, hasOther: view.chart.series.some((one) => one.colour === 'other') }).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      ) : null}
      {view.kind === 'ready' || view.kind === 'empty' ? <UsagePartialNotice machines={silentMachines} /> : null}
      {view.kind === 'ready' ? (
        <>
          <div>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={isTable}
              onClick={() => {
                onTableChange(!isTable);
              }}
              data-testid="usage-table-toggle"
            >
              {isTable ? 'Hide table' : 'Show as table'}
            </Button>
          </div>
          {isTable ? <UsageTable chart={view.chart} format={format} formatValue={formatValue} /> : null}
        </>
      ) : null}
    </section>
  );
}
