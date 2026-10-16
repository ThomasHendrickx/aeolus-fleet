'use client';

import { CircleDashed, OctagonAlert, UserCheck } from 'lucide-react';

import { MetricCard } from '../ui/molecules/metric-card';
import { useFleetSnapshot } from '../../../lib/fleet';
import { stuckCountOf, useFleetHealth } from '../../../lib/fleet-health';
import { useNow } from '../../../lib/now';
import { overviewMetrics } from '../services/overview-metrics';

/**
 * The overview's counts above the fleet (canvas, OverviewVaried): ships
 * crewed, awaiting crew with the longest wait, and the stuck deliveries with
 * since when the oldest waits. Each card opens what it counts. None
 * until the fleet is known, and none while argo is alone.
 */
export function OverviewMetrics() {
  const fleet = useFleetSnapshot();
  const health = useFleetHealth();
  const now = useNow();
  if (!fleet.data) {
    return null;
  }
  const metrics = overviewMetrics({ ships: fleet.data, stuck: health.data?.stuck ?? [], now });
  if (metrics.activeCount === 0) {
    return null;
  }
  return (
    <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-2 max-sm:gap-2.5" data-testid="overview-metrics">
      <MetricCard
        label="Ships crewed"
        shortLabel="Crewed"
        value={metrics.crewedCount}
        detail={`of ${String(metrics.activeCount)} active ships`}
        href="/?status=crewed"
        icon={UserCheck}
        tone="ok"
        testId="overview-crewed"
      />
      <MetricCard
        label="Awaiting crew"
        value={metrics.awaitingCount}
        detail={metrics.longestWait ? `Longest wait: ${metrics.longestWait.name}, ${metrics.longestWait.wait}` : 'Every active ship is crewed'}
        href="/?status=awaitingCrew"
        icon={CircleDashed}
        tone="waiting"
        testId="overview-awaiting"
      />
      <MetricCard
        label="Stuck"
        value={stuckCountOf(health.data) ?? 0}
        detail={metrics.oldestStuck ? `Deliveries stuck, oldest ${metrics.oldestStuck}` : 'Delivering'}
        href="/fleet-health"
        icon={OctagonAlert}
        tone="attention"
        testId="overview-stuck"
      />
    </div>
  );
}
