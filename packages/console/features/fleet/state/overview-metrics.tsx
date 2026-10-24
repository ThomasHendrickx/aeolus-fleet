'use client';

import { CircleDashed, OctagonAlert, UserCheck } from 'lucide-react';

import { MetricCard } from '../ui/molecules/metric-card';
import { useFleetHealth } from '../../../lib/fleet-health';
import { useNow } from '../../../lib/now';
import { duration } from '../../../lib/relative-time';
import { useShipCounts } from '../../../lib/ship-counts';
import { overviewMetrics } from '../services/overview-metrics';

/**
 * The overview's counts above the fleet (canvas, OverviewVaried): ships
 * crewed, awaiting crew with the longest wait, and the stuck deliveries with
 * since when the oldest waits. Each card opens what it counts. Each card
 * shows its own loading, so the ship counts never hold up the stuck count,
 * nor the reverse. None once the counts are known with argo alone.
 */
export function OverviewMetrics() {
  const counts = useShipCounts();
  const health = useFleetHealth().data;
  // The stuck deliveries in all, and since when the oldest of them waits.
  const stuck = health && {
    count: health.stuck.reduce((total, place) => total + place.count, 0),
    oldestSince: health.stuck.map((place) => place.oldestSince).toSorted()[0] ?? null,
  };
  const now = useNow();
  const metrics = counts.data && overviewMetrics({ counts: counts.data, now });
  if (metrics?.activeCount === 0) {
    return null;
  }
  return (
    <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-2 max-sm:gap-2.5" data-testid="overview-metrics">
      <MetricCard
        label="Ships crewed"
        shortLabel="Crewed"
        value={metrics?.crewedCount}
        detail={metrics && `of ${String(metrics.activeCount)} active ships`}
        href="/?status=crewed"
        icon={UserCheck}
        tone="ok"
        testId="overview-crewed"
      />
      <MetricCard
        label="Awaiting crew"
        value={metrics?.awaitingCount}
        detail={metrics && (metrics.longestWait ? `Longest wait: ${metrics.longestWait.name}, ${metrics.longestWait.wait}` : 'Every active ship is crewed')}
        href="/?status=awaitingCrew"
        icon={CircleDashed}
        tone="waiting"
        testId="overview-awaiting"
      />
      <MetricCard
        label="Stuck"
        value={stuck?.count}
        detail={stuck && (stuck.oldestSince === null ? 'Delivering' : `Deliveries stuck, oldest ${duration(new Date(stuck.oldestSince), now)}`)}
        href="/fleet-health"
        icon={OctagonAlert}
        tone="attention"
        testId="overview-stuck"
      />
    </div>
  );
}
