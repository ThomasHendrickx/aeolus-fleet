'use client';

import { CircleDashed, TriangleAlert, UserCheck } from 'lucide-react';

import { MetricCard } from '../molecules/metric-card';
import { useFleetSnapshot } from '../../../lib/fleet';
import { useAttentionCount, useNeedsAttention } from '../../../lib/needs-attention';
import { useNow } from '../../../lib/now';
import { overviewMetrics } from '../lib/overview-metrics';

/**
 * The overview's counts above the fleet (canvas, OverviewVaried): ships
 * crewed, awaiting crew with the longest wait, and what needs attention with
 * the oldest undeliverable delivery. Each card opens what it counts. None
 * until the fleet is known, and none while argo is alone.
 */
export function OverviewMetrics() {
  const fleet = useFleetSnapshot();
  const attention = useNeedsAttention();
  const attentionCount = useAttentionCount();
  const now = useNow();
  if (!fleet.data) {
    return null;
  }
  const metrics = overviewMetrics({ ships: fleet.data, undeliverable: attention.data ?? [], now });
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
        label="Needs attention"
        value={attentionCount ?? 0}
        detail={metrics.oldestUndeliverable ? `Undeliverable deliveries, oldest ${metrics.oldestUndeliverable}` : 'Nothing needs you'}
        href="/needs-attention"
        icon={TriangleAlert}
        tone="attention"
        testId="overview-attention"
      />
    </div>
  );
}
