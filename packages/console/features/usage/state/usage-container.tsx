'use client';

import { usePathname, useRouter } from 'next/navigation';
import { startTransition, useOptimistic } from 'react';

import { EmptyState } from '../../../components/molecules/empty-state';
import { ListPage } from '../../../components/organisms/list-page';
import { useConsoleFrame } from '../../../lib/console-frame';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNow } from '../../../lib/now';
import { useMachines, useTrierarchPluginConnection } from '../../../lib/trierarch-plugin';
import { useUsageTokens, useUsageValues, useUsageWindows } from '../hooks/usage';
import { machinesSendingNoUsage } from '../services/silent-machines';
import { windowChartsOf } from '../services/subscription-windows';
import { chartOf, totalsOf } from '../services/usage-chart';
import { filtersAfterPick, hasFilters, requestFiltersOf } from '../services/usage-filters';
import { DEFAULT_USAGE_STATE, USAGE_MEASURES, USAGE_SPLITS, usageSearchOf, type UsageBreakdownName, type UsageMeasure, type UsageSplit, type UsageState } from '../services/usage-state';
import { usageWindowOf, type UsageRange } from '../services/usage-window';
import { SegmentedControl } from '../ui/molecules/segmented-control';
import { SubscriptionWindowsCard, type WindowsView } from '../ui/organisms/subscription-windows-card';
import { UsagePanel, type UsageView } from '../ui/organisms/usage-panel';
import { UsageFilterContainer } from './usage-filter-container';

const RANGE_OPTIONS: { value: UsageRange; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];
const RANGE_WORDS: Record<UsageRange, string> = { '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days', '90d': 'last 90 days' };

const SPLIT_LABELS: Record<UsageSplit, string> = { machine: 'Machine', harness: 'Harness', model: 'Model', ship: 'Ship', login: 'Login', kind: 'Token kind' };
const SPLIT_OPTIONS = USAGE_SPLITS.map((value) => ({ value, label: SPLIT_LABELS[value] }));

const MEASURE_LABELS: Record<UsageMeasure, string> = { tokens: 'Tokens', cost: 'Estimated cost' };
const MEASURE_OPTIONS = USAGE_MEASURES.map((value) => ({ value, label: MEASURE_LABELS[value] }));

const FILTERS: { breakdown: UsageBreakdownName; label: string }[] = [
  { breakdown: 'machine', label: 'Machine' },
  { breakdown: 'harness', label: 'Harness' },
  { breakdown: 'model', label: 'Model' },
  { breakdown: 'ship', label: 'Ship' },
  { breakdown: 'login', label: 'Login' },
];

/**
 * The Usage page (usage design, "The console"): the range, the controls, and
 * the card of totals, chart, legend and table. Its state lives in the URL
 * (usage-state.ts) so a link opens it filtered; a press shows at once and the
 * URL follows. Reads `usage.tokens` for the chart and `usage.values` for the
 * filters and the machines sending no usage.
 */
export function UsageContainer({ view }: { view: UsageState }) {
  const frame = useConsoleFrame();
  const liveFleet = useLiveFleet();
  const router = useRouter();
  const pathname = usePathname();
  const now = useNow();
  const connection = useTrierarchPluginConnection();
  const [shown, setShown] = useOptimistic(view);
  const period = usageWindowOf(shown.range, now);
  const filters = requestFiltersOf(shown.filters);
  const tokens = useUsageTokens({ from: period.from, to: period.to, splitBy: shown.splitBy, measure: shown.measure, filters });
  // The windows follow the range and the machine and harness filters only, and are asked beside the tokens.
  const windows = useUsageWindows({ from: period.from, to: period.to, filters: { ...(filters.machineShipIds === undefined ? {} : { machineShipIds: filters.machineShipIds }), ...(filters.harnesses === undefined ? {} : { harnesses: filters.harnesses }) } });
  const machines = useMachines();
  const machineValues = useUsageValues({ from: period.from, to: period.to, breakdown: 'machine' });

  const change = (next: UsageState) => {
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${usageSearchOf(next)}`, { scroll: false });
    });
  };

  const panelView: UsageView = (() => {
    if (tokens.data !== undefined) {
      return tokens.data.buckets.length === 0 ? { kind: 'empty', hasFilters: hasFilters(shown.filters) } : { kind: 'ready', chart: chartOf({ usage: tokens.data, measure: shown.measure, window: period }), totals: totalsOf(tokens.data) };
    }
    return tokens.isError || connection === 'not-connected' ? { kind: 'cannot-read' } : { kind: 'loading' };
  })();

  const windowCharts = windows.charts === undefined ? undefined : windowChartsOf({ charts: windows.charts, window: period });
  const windowsView: WindowsView = (() => {
    if (windowCharts !== undefined) {
      return windowCharts.length === 0 ? { kind: 'empty' } : { kind: 'ready', charts: windowCharts };
    }
    return windows.isFailed || connection === 'not-connected' ? { kind: 'cannot-read' } : { kind: 'loading' };
  })();

  return (
    <ListPage
      {...frame}
      title="Usage"
      description="Tokens the fleet’s sessions used, as each trierarch read them from its harness’s transcripts."
      live={liveFleet.live}
      primaryAction={
        connection === 'none' ? undefined : (
          <SegmentedControl label="Time range" options={RANGE_OPTIONS} value={shown.range} onChange={(range) => { change({ ...shown, range }); }} testId="usage-range" />
        )
      }
      toolbar={
        connection === 'none' ? undefined : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="usage-controls">
            <span className="text-caption text-muted-foreground">Split by</span>
            <SegmentedControl label="Split by" options={SPLIT_OPTIONS} value={shown.splitBy} onChange={(splitBy) => { change({ ...shown, splitBy }); }} testId="usage-split" />
            <span className="text-caption text-muted-foreground">Show</span>
            <SegmentedControl label="Show" options={MEASURE_OPTIONS} value={shown.measure} onChange={(measure) => { change({ ...shown, measure }); }} testId="usage-measure" />
            <span className="text-caption text-muted-foreground">Filter</span>
            {FILTERS.map(({ breakdown, label }) => (
              <UsageFilterContainer
                key={breakdown}
                breakdown={breakdown}
                label={label}
                period={period}
                picked={shown.filters[breakdown]}
                onPickedChange={(keys) => { change({ ...shown, filters: filtersAfterPick(shown.filters, { breakdown, keys }) }); }}
              />
            ))}
          </div>
        )
      }
    >
      {connection === 'none' ? (
        <EmptyState title="The trierarch plugin is not set up for this fleet" description="Usage comes from the trierarch plugin." />
      ) : (
        <UsagePanel
          view={panelView}
          rangeWords={RANGE_WORDS[shown.range]}
          measure={shown.measure}
          splitBy={shown.splitBy}
          format={{ grain: period.grain }}
          isTable={shown.isTable}
          onTableChange={(isTable) => { change({ ...shown, isTable }); }}
          silentMachines={machinesSendingNoUsage(machines.data, machineValues.page)}
          onRetry={() => { void tokens.refetch(); }}
          onClearFilters={() => { change({ ...shown, filters: DEFAULT_USAGE_STATE.filters }); }}
        />
      )}
      {connection === 'none' ? null : (
        <SubscriptionWindowsCard
          view={windowsView}
          hasMore={windows.hasMore}
          isLoadingMore={windows.isLoadingMore}
          isLoadMoreFailed={windows.isLoadMoreFailed}
          onLoadMore={windows.loadMore}
          onRetry={windows.retry}
          rangeStartWords={new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', ...(period.grain === 'day' ? { timeZone: 'UTC' } : {}) }).format(new Date(period.from))}
        />
      )}
    </ListPage>
  );
}
